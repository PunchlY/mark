import { Injectable } from 'router';
import { JSONFeed } from './jsonfeed';
import { sql } from './db';

@Injectable()
export class Refresh {

    async #fetch(feedUrl: string) {
        let data: JSONFeed.$Input = await Bun.fetch(feedUrl);
        const { title, home_page_url, items } = await JSONFeed(data, feedUrl);
        return {
            title,
            home_page_url,
            items: items.sort(({ date_published: a }, { date_published: b }) => {
                return (a?.getTime() ?? Infinity) - (b?.getTime() ?? Infinity);
            }),
        };
    }
    async run(feedId: number, feedUrl: string) {
        const { title, home_page_url, items } = await this.#fetch(feedUrl);
        for (const item of items) {
            const key = item.id, published = item.date_published?.toISOString();
            const {
                url,
                title,
                content_html,
                authors,
            } = item;
            await sql`
            INSERT INTO Item ${sql({
                key,
                url,
                title,
                contentHtml: content_html,
                datePublished: published,
                author: authors ? authors.map(({ name }) => name.includes(',') ? JSON.stringify(name) : name).join(', ') : null,
                feedId
            })}`;
        }
        await sql`
        UPDATE Feed
        SET ${sql({
            title,
            home_page_url,
            ids: JSON.stringify(items.map(({ id }) => id)),
        })}
        WHERE
            id=${feedId}`;
        this.#errorRetryTracker.delete(feedId);
    };

    #errorRetryTracker = new Map<number, {
        count: number;
        lastRetry: number;
        message: string;
    }>();
    #refreshTimer?: Timer;
    /**
     * @param interval in seconds
     */
    enableAutoRefresh( /** @default 60 */ interval = 60) {
        this.disableAutoRefresh();
        const maxRetryCount = Math.ceil(Math.log2(24 * 60 * 60 / interval));
        this.#refreshTimer ??= setInterval(async () => {
            await sql`
            DELETE FROM Item
            WHERE
                read=1
                AND star=0
                AND id IN (
                    SELECT
                        Item.id
                    FROM Item
                    LEFT JOIN Feed ON
                        Item.feedId=Feed.id
                    WHERE
                        clean IS NOT NULL
                        AND unixepoch("now")-ifnull(Item.updatedAt,Item.createdAt)>=clean
                )`;
            await sql`
            UPDATE Item
            SET
                read=1
            WHERE
                read=0
                AND star=0
                AND id IN (
                    SELECT
                        Item.id
                    FROM Item
                    LEFT JOIN Feed ON Item.feedId=Feed.id
                    WHERE
                        markRead>0
                        AND unixepoch("now")-ifnull(Item.updatedAt,Item.createdAt)>=markRead
                )`;
            for (const { id, url, refresh } of await sql<{ id: number, url: string, refresh: number, plugins: string; }[]>`
            SELECT 
                id,
                url,
                refresh
            FROM Feed
            WHERE
                refresh IS NOT NULL
                AND (
                    ifnull(updatedAt,1)
                    OR refresh<=unixepoch("now")-updatedAt
                )`
            ) {
                const errCount = this.#errorRetryTracker.get(id);
                try {
                    if (errCount && (Date.now() - errCount.lastRetry) / 1000 > Math.min((1 << errCount.count) * interval, refresh))
                        continue;
                    await this.run(id, url);
                    this.#errorRetryTracker.delete(id);
                } catch (error) {
                    this.#errorRetryTracker.set(id, {
                        count: Math.min((errCount?.count || 0) + 1, maxRetryCount),
                        lastRetry: Date.now(),
                        message: Bun.inspect(error),
                    });
                    console.error('[refresh] %o url=%s\n%o', new Date(), url, error);
                }
            }
        }, interval * 1000);
    }
    disableAutoRefresh() {
        clearInterval(this.#refreshTimer);
        this.#refreshTimer = undefined;
    }
}
