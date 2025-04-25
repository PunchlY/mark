import { urlReplace } from 'lib/url';
import { Injectable } from 'router';
import { Module } from './api';
import { JSONFeed } from './jsonfeed';
import { sql } from './db';

class Rewriter {
    #rewriter?: HTMLRewriter;
    get #init() {
        return this.#rewriter ??= new HTMLRewriter()
            .onDocument({
                doctype(e) {
                    e.remove();
                },
                comments(doc) {
                    doc.remove();
                },
            })
            .on('link, script, style, noscript', {
                element(e) {
                    e.remove();
                }
            })
            .on('*', {
                element(e) {
                    if (e.removed)
                        return;
                    for (const [name] of e.attributes) {
                        if (name.startsWith('on'))
                            e.removeAttribute(name);
                    }
                    e.removeAttribute('class');
                },
            });
    }

    async transform(content: Response | string) {
        if (typeof content === 'string')
            return this.#init.transform(content);
        return this.#init.transform(content!).text();
    }

    scraper(selector: string) {
        let depth = 0;
        this.#init
            .onDocument({
                doctype(e) {
                    e.remove();
                },
            })
            .on(selector, {
                element(e) {
                    depth++;
                    e.onEndTag(() => { depth--; });
                },
            })
            .on('*', {
                element(e) {
                    if (depth)
                        return;
                    e.removeAndKeepContent();
                },
                text(e) {
                    if (depth)
                        return;
                    e.remove();
                },
            });
    }
    remove(selector: string) {
        this.#init.on(selector, {
            element(e) {
                e.remove();
            },
        });
    }
    rewriteImageUrl(name?: string, replacement?: string, base?: string) {
        this.#init.on('img[src]', {
            async element(e) {
                if (e.removed)
                    return;
                const src = e.getAttribute(name ?? 'src');
                if (!src)
                    return;
                if (name && name !== 'src')
                    e.removeAttribute(name);
                if (replacement)
                    e.setAttribute('src', urlReplace(new URL(src, base), replacement));
                else
                    e.setAttribute('src', src);
            },
        });
    }

}

@Injectable()
export class Refresh {

    async #fetch(feedUrl: string, {
        requestHeader: headers,
        proxy,
        jq,
        limit,
    }: Module.Plugins) {
        let data: JSONFeed.$Input = await Bun.fetch(feedUrl, { headers: headers ?? undefined, proxy: proxy ?? undefined });
        if (jq)
            data = await Bun.$`jq ${jq} < ${data}`.json();
        const { title, home_page_url, items } = await JSONFeed(data, feedUrl);
        if (limit)
            items.length = limit;
        return {
            title,
            home_page_url,
            items: items.sort(({ date_published: a }, { date_published: b }) => {
                return (a?.getTime() ?? Infinity) - (b?.getTime() ?? Infinity);
            }),
        };
    }
    async #rewriter(feedUrl: string, homePage: string | undefined, item: JSONFeed.Item, {
        urlRewrite,
        requestHeader: headers,
        proxy,
        scraper,
        remove,
        rewriteImageUrl,
    }: Module.Plugins) {
        if (item.url && urlRewrite)
            item.url = urlReplace(item.url, urlRewrite);
        let content: Response | string | null | undefined = item.content_html;
        const rewriter = new Rewriter();
        if (scraper) {
            if (!item.url)
                throw new Error('Item URL is missing, cannot proceed with scraping.');
            content = await Bun.fetch(item.url, { headers: headers ?? undefined, proxy: proxy ?? undefined });
            rewriter.scraper(scraper);
        }
        if (remove)
            rewriter.remove(remove);
        if (rewriteImageUrl) {
            const { name, replacement } = rewriteImageUrl;
            rewriter.rewriteImageUrl(name, replacement, homePage || feedUrl);
        }
        if (content)
            content = await rewriter.transform(content);
        return {
            ...item,
            content_html: content,
        };
    }
    async run(feedId: number, feedUrl: string, plugins: Module.Plugins) {
        const { title, home_page_url, items } = await this.#fetch(feedUrl, plugins);
        if (plugins.limit)
            items.length = plugins.limit;
        for (const item of items) {
            if (sql`
            SELECT
                key
            FROM Item
            WHERE
                key=${item.id}
                AND feedId=${feedId}
            UNION
            SELECT
                value as key
            FROM json_each((SELECT ids FROM Feed WHERE id=${feedId} LIMIT 1))
            WHERE
                value=${item.id}
            LIMIT 1`
                .get<{ key: number; }>()
            ) continue;
            const key = item.id, published = item.date_published?.toISOString();
            const {
                url,
                title,
                content_html,
                authors,
            } = await this.#rewriter(feedUrl, home_page_url ?? undefined, item, plugins);
            sql`
            INSERT INTO Item (
                key,
                url,
                title,
                contentHtml,
                datePublished,
                author,
                feedId
            ) VALUES (
                ${key},
                ${url ?? null},
                ${title ?? null},
                ${content_html ?? null},
                unixepoch(${published ?? null}),
                ${authors ? authors.map(({ name }) => name.includes(',') ? JSON.stringify(name) : name).join(', ') : null},
                ${feedId})`
                .run();
            sql`UPDATE Feed SET ids=(SELECT json_insert((SELECT ids FROM Feed WHERE id=${feedId}),"$[#]",${key})) WHERE id=${feedId}`
                .run();
        }
        sql`
        UPDATE Feed
        SET
            title=${title},
            homePage=${home_page_url ?? null},
            ids=${JSON.stringify(items.map(({ id }) => id))}
        WHERE
            id=${feedId}`
            .run();
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
            sql`
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
                )`
                .run();
            sql`
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
                )`
                .run();
            for (const { id, url, refresh, plugins } of sql`
            SELECT 
                id,
                url,
                plugins,
                refresh
            FROM Feed
            WHERE
                refresh IS NOT NULL
                AND (ifnull(updatedAt,1)
                OR refresh<=unixepoch("now")-updatedAt)`
                .iterate<{ id: number, url: string, refresh: number, plugins: string; }>()
            ) {
                const errCount = this.#errorRetryTracker.get(id);
                try {
                    if (errCount && Date.now() - errCount.lastRetry > Math.min((1 << errCount.count) * interval, refresh))
                        continue;
                    await this.run(id, url, JSON.parse(plugins));
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
