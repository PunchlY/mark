// https://github.com/feedbin/feedbin-api

import { Hono, type Context } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import db from 'db';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const subscriptionsStmt = db.query<{
    id: number;
    feed_id: number;
    title: string;
    feed_url: string;
    site_url: string;
}, []>('SELECT id, id feed_id, title, url feed_url, homePage site_url FROM Feed WHERE title IS NOT NULL');

const taggingsStmt = db.query<{
    id: number;
    feed_id: number;
    name: string;
}, []>('SELECT Feed.id, Feed.id feed_id, name FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE title IS NOT NULL');

const unreadEntriesStmt = db.query<{ id: number; }, []>('SELECT id FROM Item WHERE read=0');
const updatEntriesReadStmt = db.query<{ id: number; }, [read: boolean, idsJSON: string]>('UPDATE Item SET read=? WHERE id IN (SELECT value from json_each(?)) RETURNING id');

const starredEntriesStmt = db.query<{ id: number; }, []>('SELECT id FROM Item WHERE star=1');
const updatEntriesStarStmt = db.query<{ id: number; }, [star: boolean, idsJSON: string]>('UPDATE Item SET star=? WHERE id IN (SELECT value from json_each(?)) RETURNING id');

const entriesStmt = db.query<unknown, [{
    read: boolean | null;
    star: boolean | null;
    limit: number;
    offset: number;
}]>(
    'SELECT Item.id, Feed.id feed_id, Item.title, Item.url, (SELECT group_concat(json_extract(value,"$.name"),", ") from json_each(authors)) author, contentHtml content, ifnull(Item.datePublished, Item.createdAt) publishedAt, createdAt FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id LEFT JOIN Category ON Feed.categoryId=Category.id WHERE ifnull(read=$read,1) AND ifnull(star=$star,1) AND Feed.title IS NOT NULL ORDER BY Item.id DESC LIMIT $limit OFFSET $offset'
).as(class {
    declare id: number;
    declare feed_id: number;
    declare title: string | null;
    declare url: string | null;
    declare author: string | null;
    declare content: string | null;
    declare publishedAt: number;
    declare createdAt: number;

    toJSON() {
        const { publishedAt, createdAt, ...data } = this;
        return {
            ...data,
            summary: null,
            published: new Date(publishedAt * 1000).toISOString(),
            created_at: new Date(createdAt * 1000).toISOString(),
        };
    }
});

export default new Hono<{ Bindings: Bindings; }>()
    .basePath('/v2')
    .use(basicAuth({
        verifyUser(username, password, c: Context<{ Bindings: Bindings; }>) {
            return username === c.env.EMAIL && password === c.env.PASSWORD;
        },
    }))
    .get('/authentication.json', async (c) => {
        return c.body(null, 200, { 'Content-Type': 'application/json' });
    })
    .get('/subscriptions.json', async (c) => {
        return c.json(subscriptionsStmt.all());
    })
    .get('/taggings.json', async (c) => {
        return c.json(taggingsStmt.all());
    })
    .get('/unread_entries.json', async (c) => {
        return c.json(unreadEntriesStmt.all().map(({ id }) => id));
    })
    .post('/unread_entries.json', zValidator('json', z.object({
        unread_entries: z.coerce.number().int().positive().array(),
    })), async (c) => {
        const { unread_entries } = c.req.valid('json');
        return c.json(updatEntriesReadStmt.all(false, JSON.stringify(unread_entries)).map(({ id }) => id));
    })
    .delete('/unread_entries.json', zValidator('json', z.object({
        unread_entries: z.coerce.number().int().positive().array(),
    })), async (c) => {
        const { unread_entries } = c.req.valid('json');
        return c.json(updatEntriesReadStmt.all(true, JSON.stringify(unread_entries)).map(({ id }) => id));
    })
    .get('/starred_entries.json', async (c) => {
        return c.json(starredEntriesStmt.all().map(({ id }) => id));
    })
    .post('/starred_entries.json', zValidator('json', z.object({
        starred_entries: z.coerce.number().int().positive().array(),
    })), async (c) => {
        const { starred_entries } = c.req.valid('json');
        return c.json(updatEntriesStarStmt.all(true, JSON.stringify(starred_entries)).map(({ id }) => id));
    })
    .delete('/starred_entries.json', zValidator('json', z.object({
        starred_entries: z.coerce.number().int().positive().array(),
    })), async (c) => {
        const { starred_entries } = c.req.valid('json');
        return c.json(updatEntriesStarStmt.all(false, JSON.stringify(starred_entries)).map(({ id }) => id));
    })
    .get('/entries.json', zValidator('query', z.object({
        page: z.coerce.number().int().positive().default(1),
        read: z.enum(['true', 'false']).transform((s) => s === 'true').optional(),
        starred: z.enum(['true', 'false']).transform((s) => s === 'true').optional(),
        per_page: z.coerce.number().nonnegative().default(10),
    }).transform(({ page, read, starred, per_page }) => {
        return {
            read: read ?? null,
            star: starred ?? null,
            limit: per_page,
            offset: (page - 1) * per_page,
        };
    })), async (c) => {
        return c.json(entriesStmt.all(c.req.valid('query')));
    });
