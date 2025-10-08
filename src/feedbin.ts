// https://github.com/feedbin/feedbin-api

import { Body, Controller, Route, Query, Use } from 'router';
import { Type, type StaticDecode } from '@sinclair/typebox';
import { sql } from './db';
import { BasicAuth } from './basic';

export namespace Module {
    export type Ids = StaticDecode<typeof Ids>;
    export const Ids = Type.Array(Type.Integer({ minimum: 1 }));

    export type FindEntries = StaticDecode<typeof FindEntries>;
    export const FindEntries = Type.Object({
        read: Type.Optional(Type.Boolean()),
        starred: Type.Optional(Type.Boolean()),
        per_page: Type.Integer({ minimum: 1, default: 10 }),
        page: Type.Integer({ minimum: 1, default: 1 }),
    });
}

@Use(BasicAuth)
@Controller({ prefix: '/v2' })
export class FeedBin {
    @Route('GET', '/authentication.json')
    authentication() {
        return true;
    }

    @Route('GET', '/subscriptions.json')
    subscriptions() {
        return sql<{
            id: number;
            feed_id: number;
            title: string;
            feed_url: string;
            site_url: string;
        }[]>`SELECT id, id feed_id, title, url feed_url, homePage site_url FROM Feed WHERE title IS NOT NULL`;
    }

    @Route('GET', '/taggings.json')
    taggings() {
        return sql<{
            id: number;
            feed_id: number;
            name: string;
        }[]>`SELECT id, id feed_id, category name FROM Feed WHERE title IS NOT NULL`;
    }

    @Route('GET', '/unread_entries.json')
    async unreadEntries() {
        const res = await sql<{ id: number; }[]>`SELECT id FROM Item WHERE read=0`;
        return res.map(({ id }) => id);
    }
    async #read(read: boolean, entries: Module.Ids) {
        const res = await sql<{ id: number; }[]>`UPDATE Item SET read=${read} WHERE id IN ${sql(entries)} RETURNING id`;
        return res.map(({ id }) => id);
    }
    @Route('DELETE', '/unread_entries.json')
    read(@Body('unread_entries', { operations: ['Assert'] }) entries: Module.Ids) {
        return this.#read(true, entries);
    }
    @Route('POST', '/unread_entries.json')
    unread(@Body('unread_entries', { operations: ['Assert'] }) entries: Module.Ids) {
        return this.#read(false, entries);
    }

    @Route('GET', '/starred_entries.json')
    async starredEntries() {
        const res = await sql<{ id: number; }[]>`SELECT id FROM Item WHERE star=1`;
        return res.map(({ id }) => id);
    }
    async #star(star: boolean, entries: Module.Ids) {
        const res = await sql<{ id: number; }[]>`UPDATE Item SET star=${star} WHERE id IN ${sql(entries)} RETURNING id`;
        return res.map(({ id }) => id);
    }
    @Route('DELETE', '/starred_entries.json')
    unstar(@Body('starred_entries', { operations: 'Assert' }) entries: Module.Ids) {
        return this.#star(false, entries);
    }
    @Route('POST', '/starred_entries.json')
    star(@Body('starred_entries', { operations: 'Assert' }) entries: Module.Ids) {
        return this.#star(true, entries);
    }

    @Route('GET', '/entries.json')
    async entries(@Query({ operations: ['Default', 'Convert', 'Assert'] }) { read, starred, per_page, page }: Module.FindEntries) {
        const res = await sql<{
            id: number;
            feed_id: number;
            title: string | null;
            url: string | null;
            author: string | null;
            content: string | null;
            publishedAt: number;
            createdAt: number;
        }[]>`
            SELECT
                Item.id,
                Feed.id feed_id,
                Item.title,
                Item.url,
                author,
                contentHtml content,
                ifnull(Item.datePublished, Item.createdAt) publishedAt,
                createdAt
            FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id
            WHERE 
                Feed.title IS NOT NULL
                ${read === undefined ? sql`` : sql`AND read=${read}`}
                ${read === undefined ? sql`` : sql`AND star=${starred}`}
            ORDER BY
                Item.id DESC
            LIMIT ${per_page}
            OFFSET ${(page - 1) * per_page}`;
        return res.map(({ title, url, publishedAt, createdAt, ...data }) => {
            return {
                ...data,
                title: title ?? '',
                url: url ?? '',
                summary: null,
                published: new Date(publishedAt * 1000).toISOString(),
                created_at: new Date(createdAt * 1000).toISOString(),
            };
        });
    }
}
