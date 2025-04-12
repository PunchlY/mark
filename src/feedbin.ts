// https://github.com/feedbin/feedbin-api

import { Body, Controller, Route, Query, Use } from 'router';
import { Type, type StaticDecode } from '@sinclair/typebox';
import { empty, join, sql } from './db';
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
@Controller('/v2')
export class FeedBin {
    @Route('GET', '/authentication.json')
    authentication() {
        return true;
    }

    @Route('GET', '/subscriptions.json')
    subscriptions() {
        return sql`SELECT id, id feed_id, title, url feed_url, homePage site_url FROM Feed WHERE title IS NOT NULL`
            .all<{
                id: number;
                feed_id: number;
                title: string;
                feed_url: string;
                site_url: string;
            }>();
    }

    @Route('GET', '/taggings.json')
    taggings() {
        return sql`SELECT id, id feed_id, category name FROM Feed WHERE title IS NOT NULL`
            .all<{
                id: number;
                feed_id: number;
                name: string;
            }>();
    }

    @Route('GET', '/unread_entries.json')
    unreadEntries() {
        return sql`SELECT id FROM Item WHERE read=0`
            .iterate<{ id: number; }>()
            .map(({ id }) => id)
            .toArray();
    }
    @Route('DELETE', '/unread_entries.json')
    read(@Body('unread_entries', { operations: ['Assert'] }) entries: Module.Ids) {
        return sql`UPDATE Item SET read=${true} WHERE id IN (SELECT value from json_each(${JSON.stringify(entries)})) RETURNING id`
            .iterate<{ id: number; }>()
            .map(({ id }) => id)
            .toArray();
    }
    @Route('POST', '/unread_entries.json')
    unread(@Body('unread_entries', { operations: ['Assert'] }) entries: Module.Ids) {
        return sql`UPDATE Item SET read=${false} WHERE id IN (SELECT value from json_each(${JSON.stringify(entries)})) RETURNING id`
            .iterate<{ id: number; }>()
            .map(({ id }) => id)
            .toArray();
    }

    @Route('GET', '/starred_entries.json')
    starredEntries() {
        return sql`SELECT id FROM Item WHERE star=1`
            .iterate<{ id: number; }>()
            .map(({ id }) => id)
            .toArray();
    }
    @Route('DELETE', '/starred_entries.json')
    unstar(@Body('starred_entries', { operations: 'Assert' }) entries: Module.Ids) {
        return sql`UPDATE Item SET star=${false} WHERE id IN (SELECT value from json_each(${JSON.stringify(entries)})) RETURNING id`
            .iterate<{ id: number; }>()
            .map(({ id }) => id)
            .toArray();
    }
    @Route('POST', '/starred_entries.json')
    star(@Body('starred_entries', { operations: 'Assert' }) entries: Module.Ids) {
        return sql`UPDATE Item SET star=${true} WHERE id IN (SELECT value from json_each(${JSON.stringify(entries)})) RETURNING id`
            .iterate<{ id: number; }>()
            .map(({ id }) => id)
            .toArray();
    }

    @Route('GET', '/entries.json')
    entries(@Query({ operations: ['Default', 'Convert', 'Assert'] }) { read, starred, per_page, page }: Module.FindEntries) {
        return sql`
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
            WHERE ${join([
            sql`Feed.title IS NOT NULL`,
            typeof read === 'undefined' ? empty : sql`read=${read}`,
            typeof starred === 'undefined' ? empty : sql`star=${starred}`,
        ], ' AND ')}
            ORDER BY
                Item.id DESC
            LIMIT ${per_page}
            OFFSET ${(page - 1) * per_page}`
            .iterate<{
                id: number;
                feed_id: number;
                title: string | null;
                url: string | null;
                author: string | null;
                content: string | null;
                publishedAt: number;
                createdAt: number;
            }>()
            .map(({ title, url, publishedAt, createdAt, ...data }) => {
                return {
                    ...data,
                    title: title ?? '',
                    url: url ?? '',
                    summary: null,
                    published: new Date(publishedAt * 1000).toISOString(),
                    created_at: new Date(createdAt * 1000).toISOString(),
                };
            })
            .toArray();
    }
}
