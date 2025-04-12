import { Body, Route, Use, Query, Controller, Injectable } from 'router';
import { Type, type StaticDecode } from '@sinclair/typebox';
import { empty, join, sql } from './db';
import { BasicAuth } from './basic';
import { JSONFeed } from './jsonfeed';
import { HTTPResponseError } from './error';
import { urlReplace } from 'lib/url';

export namespace Module {

    export type Ids = StaticDecode<typeof Ids>;
    export const Ids = Type.Union([
        Type.Literal('all'),
        Type.Integer({ minimum: 1 }),
        Type.Array(Type.Integer({ minimum: 1 })),
    ], { default: 'all' });

    export type Subscribe = StaticDecode<typeof Subscribe>;
    export const Subscribe = Type.Object({
        url: Type.String({ format: 'url' }),
        category: Type.String({ minLength: 1, default: 'Uncategorized' }),
        refresh: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
        markRead: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
        clean: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
        plugins: Type.Partial(Type.Object({
            proxy: Type.String({ format: 'url' }),
            requestHeader: Type.Record(Type.String(), Type.String()),

            jq: Type.String(),
            limit: Type.Integer({ minimum: 0 }),

            urlRewrite: Type.String(),
            scraper: Type.String(),
            remove: Type.String(),
            rewriteImageUrl: Type.Partial(Type.Object({
                name: Type.String({ format: 'attribute-name' }),
                replacement: Type.String(),
            })),
        }, { default: {} })),
    });

    export type Plugins = StaticDecode<typeof Plugins>;
    export const Plugins = Type.Index(Subscribe, ['plugins']);

    export class Feed {
        declare id: number;
        declare title: string | null;
        declare url: string;
        declare homePage: string;
        declare refresh: number;
        declare markRead: number;
        declare clean: number;
        declare plugins: string;
        declare updatedAt: number | null;
        declare category: string;
        toJSON() {
            const { updatedAt, plugins, ...data } = this;
            return {
                ...data,
                updatedAt: updatedAt === null ? undefined : new Date(updatedAt * 1000),
                plugins: JSON.parse(plugins) as Module.Plugins,
            };
        }
    }

    export type QueryFilters = StaticDecode<typeof QueryFilters>;
    export const QueryFilters = Type.Object({
        feedId: Ids,
        category: Type.Optional(Type.String({ minLength: 1 })),
        read: Type.Optional(Type.Boolean()),
        star: Type.Optional(Type.Boolean()),
        limit: Type.Integer({ default: 10, minimum: 1 }),
        offset: Type.Integer({ default: 0, minimum: 0 }),
        order: Type.Union([Type.Literal('asc'), Type.Literal('desc')], { default: 'desc' }),
    });

    export class Item {
        declare id: string;
        declare title: string | null;
        declare url: string | null;
        declare author: string | null;
        declare content_html: string | null;
        declare publishedAt: number;
        declare feedId: number;
        declare read: number;
        declare star: number;

        toJSON() {
            const { publishedAt, ...data } = this;
            return {
                ...data,
                date_published: new Date(publishedAt * 1000).toISOString(),
            };
        }
    }
}

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
@Controller()
export class Refresh {

    async #fetch(feedUrl: string, {
        requestHeader: headers,
        proxy,
        jq,
        limit,
    }: Module.Plugins) {
        let data: JSONFeed.$Input = await Bun.fetch(feedUrl, { headers, proxy });
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
            content = await Bun.fetch(item.url, { headers, proxy });
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
    async #refresh(feedId: number, feedUrl: string, plugins: Module.Plugins) {
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
    beginAutoRefresh( /** @default 60 */ interval = 60) {
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
                    await this.#refresh(id, url, JSON.parse(plugins));
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

    @Route('PUT', '/feeds', { status: 204 })
    async refresh(@Query('id') id: Module.Ids) {
        const resultList = await Promise.allSettled(
            sql`
            SELECT id, url, plugins
            FROM Feed
            WHERE
                ${id === 'all' ? sql`true` : Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}`
                .iterate<{ id: number, url: string, plugins: string; }>()
                .map(async ({ id, url, plugins }) => {
                    await this.#refresh(id, url, JSON.parse(plugins));
                })
        );
        let hasError = false;
        for (const result of resultList) {
            if (result.status === 'fulfilled')
                continue;
            hasError = true;
            console.error('[refresh] %o\n%o', new Date(), result.reason);
        }
        if (hasError)
            throw new HTTPResponseError('Failed to refresh feeds');
        return true;
    }
}

@Use(BasicAuth)
@Use(Refresh)
@Controller()
export class API {

    @Route('GET', '/feeds')
    feeds(@Query('id') id: Module.Ids) {
        return sql`
        SELECT id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category
        FROM Feed
        WHERE
            ${id === 'all' ? sql`true` : Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}
        ${id === 'all' ? empty : Array.isArray(id) ? sql`LIMIT ${id.length}` : sql`LIMIT 1`}`
            .all(Module.Feed);
    }

    @Route('POST', '/feeds')
    subscribe(@Body() { url, category, refresh, markRead, clean, plugins }: Module.Subscribe) {
        return sql`
        INSERT INTO Feed (url, category, refresh, markRead, clean, plugins)
        VALUES (${url}, ${category}, ${refresh}, ${markRead}, ${clean}, ${JSON.stringify(plugins)})
        RETURNING id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category`
            .get(Module.Feed)!;
    }

    @Route('DELETE', '/feeds')
    unsubscribe(@Query('id') id: Module.Ids) {
        if (id === 'all')
            throw new Error('Cannot delete all feeds');
        return sql`
        DELETE FROM Feed
        WHERE
            ${Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}
        RETURNING id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category`
            .all<Module.Feed>();
    }

    @Route('PATCH', '/feeds')
    update(
        @Query('id') id: Module.Ids,
        @Body({
            schema: Type.Partial(Module.Subscribe),
            operations: ['Clean', 'Convert', 'Assert'],
        }) { category, url, refresh, markRead, clean, plugins }: Partial<Module.Subscribe>,
    ) {
        if (typeof url !== 'undefined' && (id === 'all' || Array.isArray(id)))
            throw new Error('Cannot update all feeds with a URL');
        return sql`
        UPDATE Feed
        SET ${join([
            typeof url === 'undefined' ? empty : sql`url=${url}`,
            typeof category === 'undefined' ? empty : sql`category=${category}`,
            typeof refresh === 'undefined' ? empty : sql`refresh=${refresh}`,
            typeof markRead === 'undefined' ? empty : sql`markRead=${markRead}`,
            typeof clean === 'undefined' ? empty : sql`clean=${clean}`,
            typeof plugins === 'undefined' ? empty : sql`plugins=${JSON.stringify(plugins)}`,
        ], ',')}
        WHERE
            ${id === 'all' ? sql`true` : Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}
        RETURNING id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category`
            .get<Module.Feed>() ?? undefined;
    }

    @Route('GET', '/entries')
    entries(@Query() { feedId, read, star, limit, offset, order }: Module.QueryFilters) {
        return sql`
        SELECT
            id,
            title,
            url,
            author,
            contentHtml content_html,
            ifnull(datePublished, createdAt) publishedAt,
            feedId,
            read,
            star
        FROM Item
        WHERE ${join([
            feedId === 'all' ? sql`true` : Array.isArray(feedId) ? sql`feedId IN (${join(feedId)})` : sql`feedId=${feedId}`,
            typeof read === 'undefined' ? empty : sql`read=${read}`,
            typeof star === 'undefined' ? empty : sql`star=${star}`,
        ], ' AND ')}
        ORDER BY
            ${order === 'asc' ? sql`id ASC` : sql`id DESC`}
        LIMIT ${limit}
        OFFSET ${offset}`
            .all(Module.Item);
    }

}
