import { Body, Route, Use, Query, Controller } from 'router';
import { Type, type StaticDecode } from '@sinclair/typebox';
import { empty, join, sql } from './db';
import { BasicAuth } from './basic';
import { HTTPResponseError } from './error';
import { Refresh } from './refresh';

export namespace Module {

    export type Ids = StaticDecode<typeof Ids>;
    export const Ids = Type.Union([
        Type.Integer({ minimum: 1 }),
        Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
    ]);

    export type Plugins = StaticDecode<typeof Plugins>;
    export const Plugins = Type.Partial(Type.Object({
        proxy: Type.Union([Type.String({ format: 'url' }), Type.Null()]),
        requestHeader: Type.Union([Type.Record(Type.String(), Type.String()), Type.Null()]),

        jq: Type.Union([Type.String(), Type.Null()]),
        limit: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),

        urlRewrite: Type.Union([Type.String(), Type.Null()]),
        scraper: Type.Union([Type.String(), Type.Null()]),
        remove: Type.Union([Type.String(), Type.Null()]),
        rewriteImageUrl: Type.Union([Type.Partial(Type.Object({
            name: Type.String({ format: 'attribute-name' }),
            replacement: Type.String(),
        })), Type.Null()]),
    }));

    export type Subscribe = StaticDecode<typeof Subscribe>;
    export const Subscribe = Type.Composite([
        Type.Object({
            url: Type.String({ format: 'url' }),
            category: Type.String({ minLength: 1, default: 'Uncategorized' }),
            refresh: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
            markRead: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
            clean: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
        }),
        Plugins,
    ]);

    export class Feed {
        declare id: number;
        declare title: string | null;
        declare url: string;
        declare homePage: string | null;
        declare refresh: number | null;
        declare markRead: number | null;
        declare clean: number | null;
        declare plugins: string;
        declare updatedAt: number | null;
        declare category: string;
        toJSON() {
            const { updatedAt, plugins, ...data } = this;
            return {
                ...JSON.parse(plugins) as Module.Plugins,
                ...data,
                updatedAt: updatedAt === null ? undefined : new Date(updatedAt * 1000),
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
        page: Type.Integer({ default: 1, minimum: 1 }),
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

@Use(BasicAuth)
@Controller()
export class API {

    constructor(private refreshService: Refresh) {
    }

    @Route('GET', '/list')
    list() {
        return sql`SELECT id, title, url, homePage, category FROM Feed`
            .all<{ id: number, title: string | null, url: string, homePage: string | null, category: string; }>();
    }

    @Route('GET', '/feeds')
    feeds(@Query('id') id: Module.Ids) {
        return sql`
        SELECT id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category
        FROM Feed
        WHERE
            ${Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}
        ${Array.isArray(id) ? sql`LIMIT ${id.length}` : sql`LIMIT 1`}`
            .all(Module.Feed);
    }

    @Route('POST', '/feeds')
    subscribe(@Body() { url, category, refresh, markRead, clean, ...plugins }: Module.Subscribe) {
        return sql`
        INSERT INTO Feed (url, category, refresh, markRead, clean, plugins)
        VALUES (${url}, ${category}, ${refresh}, ${markRead}, ${clean}, json_patch('{}',${JSON.stringify(plugins)}))
        RETURNING id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category`
            .all(Module.Feed);
    }

    @Route('DELETE', '/feeds')
    unsubscribe(@Query('id') id: Module.Ids) {
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
        }) { category, url, refresh, markRead, clean, ...plugins }: Partial<Module.Subscribe>,
    ) {
        if (typeof url !== 'undefined' && Array.isArray(id))
            throw new Error('Cannot update all feeds with a URL');
        return sql`
        UPDATE Feed
        SET ${join([
            typeof url === 'undefined' ? empty : sql`url=${url}`,
            typeof category === 'undefined' ? empty : sql`category=${category}`,
            typeof refresh === 'undefined' ? empty : sql`refresh=${refresh}`,
            typeof markRead === 'undefined' ? empty : sql`markRead=${markRead}`,
            typeof clean === 'undefined' ? empty : sql`clean=${clean}`,
            typeof plugins === 'undefined' ? empty : sql`plugins=json_patch(plugins,${JSON.stringify(plugins)})`,
        ], ',')}
        WHERE
            ${Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}
        RETURNING id, title, url, homePage, refresh, markRead, clean, plugins, updatedAt, category`
            .all<Module.Feed>();
    }

    @Route('PUT', '/feeds', { status: 204 })
    async refresh(@Query('id') id: Module.Ids) {
        const resultList = await Promise.allSettled(
            sql`
            SELECT id, url, plugins
            FROM Feed
            WHERE
                ${Array.isArray(id) ? sql`id IN (${join(id)})` : sql`id=${id}`}`
                .iterate<{ id: number, url: string, plugins: string; }>()
                .map(async ({ id, url, plugins }) => {
                    await this.refreshService.run(id, url, JSON.parse(plugins));
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

    @Route('GET', '/entries')
    entries(@Query() { feedId, read, star, limit, page, order }: Module.QueryFilters) {
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
            Array.isArray(feedId) ? sql`feedId IN (${join(feedId)})` : sql`feedId=${feedId}`,
            typeof read === 'undefined' ? empty : sql`read=${read}`,
            typeof star === 'undefined' ? empty : sql`star=${star}`,
        ], ' AND ')}
        ORDER BY
            ${order === 'asc' ? sql`id ASC` : sql`id DESC`}
        LIMIT ${limit}
        OFFSET ${(page - 1) * limit}`
            .all(Module.Item);
    }

}
