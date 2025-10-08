import { Body, Route, Use, Query, Controller, Inject } from 'router';
import { Type, type StaticDecode } from '@sinclair/typebox';
import { sql } from './db';
import { BasicAuth } from './basic';
import { Refresh } from './refresh';

export namespace Module {

    export type Ids = StaticDecode<typeof Ids>;
    export const Ids = Type.Union([
        Type.Transform(Type.Integer({ minimum: 1 }))
            .Decode((i) => [i])
            .Encode(([i]) => i),
        Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
    ]);

    export type Subscribe = StaticDecode<typeof Subscribe>;
    export const Subscribe = Type.Object({
        url: Type.String({ format: 'url' }),
        category: Type.String({ minLength: 1, default: 'Uncategorized' }),
        refresh: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
        markRead: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
        clean: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { default: null }),
    });

    export class Feed {
        declare id: number;
        declare title: string | null;
        declare url: string;
        declare homePage: string | null;
        declare refresh: number | null;
        declare markRead: number | null;
        declare clean: number | null;
        declare updatedAt: number | null;
        declare category: string;
        toJSON() {
            const { updatedAt, ...data } = this;
            return {
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
    @Inject()
    readonly refreshService!: Refresh;

    @Route('GET', '/list')
    list() {
        return sql<{ id: number, title: string | null, url: string, homePage: string | null, category: string; }[]>`SELECT id, title, url, homePage, category FROM Feed`;
    }

    @Route('GET', '/feeds')
    feeds(@Query('id') id: Module.Ids) {
        return sql<Module.Feed[]>`
        SELECT id, title, url, homePage, refresh, markRead, clean, updatedAt, category
        FROM Feed
        WHERE
            id IN ${sql(id)}
        ${Array.isArray(id) ? sql`LIMIT ${id.length}` : sql`LIMIT 1`}`;
    }

    @Route('POST', '/feeds')
    subscribe(@Body() { url, category, refresh, markRead, clean }: Module.Subscribe) {
        return sql<Module.Feed[]>`
        INSERT INTO Feed ${sql({
            url,
            category,
            refresh,
            markRead,
            clean,
        })}
        RETURNING id, title, url, homePage, refresh, markRead, clean, updatedAt, category`;
    }

    @Route('DELETE', '/feeds')
    unsubscribe(@Query('id') id: Module.Ids) {
        return sql<Module.Feed[]>`
        DELETE FROM Feed
        WHERE
            id IN ${sql(id)}
        RETURNING id, title, url, homePage, refresh, markRead, clean, updatedAt, category`;
    }

    @Route('PATCH', '/feeds')
    update(
        @Query('id') id: Module.Ids,
        @Body({
            schema: Type.Partial(Module.Subscribe),
            operations: ['Clean', 'Convert', 'Assert'],
        }) { category, url, refresh, markRead, clean }: Partial<Module.Subscribe>,
    ) {
        if (url !== undefined && Array.isArray(id))
            throw new Error('Cannot update all feeds with a URL');
        return sql<Module.Feed[]>`
        UPDATE Feed
        SET ${sql({
            url,
            category,
            refresh,
            markRead,
            clean,
        })}
        WHERE
            id IN ${sql(id)}
        RETURNING id, title, url, homePage, refresh, markRead, clean, updatedAt, category`;
    }

    @Route('PUT', '/feeds', { status: 204 })
    async refresh(@Query('id') ids: Module.Ids) {
        for (const { id, url } of await sql<{ id: number, url: string; }[]>`
        SELECT id, url
        FROM Feed
        WHERE
            id IN ${sql(ids)}`
        ) try {
            await this.refreshService.run(id, url);
        } catch (error) {
            console.error('[refresh] %o\n%o', new Date(), error);
        }

        return true;
    }

    @Route('GET', '/entries')
    entries(@Query() { feedId, read, star, limit, page, order }: Module.QueryFilters) {
        return sql<Module.Item[]>`
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
        WHERE
            feedId IN ${sql(feedId)}
            ${read === undefined ? sql`` : sql`AND read=${read}`}
            ${star === undefined ? sql`` : sql`AND star=${star}`}
        ORDER BY
            ${order === 'asc' ? sql`id ASC` : sql`id DESC`}
        LIMIT ${limit}
        OFFSET ${(page - 1) * limit}`;
    }

}
