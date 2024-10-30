// https://github.com/feedbin/feedbin-api

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import db from 'db';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const app = new Hono<{
    Bindings: {
        EMAIL: string;
        PASSWORD: string;
    };
}>().basePath('/v2').use(basicAuth({
    verifyUser(username, password, c) {
        return username === c.env.EMAIL && password === c.env.PASSWORD;
    },
}));

app.get('/authentication.json', async (c) => {
    return c.body(null, 200, { 'Content-Type': 'application/json' });
});

const subscriptionsStmt = db.query<{
    id: number;
    feed_id: number;
    feed_url: string;
    site_url: string;
}, []>('SELECT id, id feed_id, title, url feed_url, homePage site_url FROM Feed WHERE title IS NOT NULL');
app.get('/subscriptions.json', async (c) => {
    return c.json(subscriptionsStmt.all());
});

const taggingsStmt = db.query<{
    id: number;
    feed_id: number;
    name: string;
}, []>('SELECT Feed.id, Feed.id feed_id, name FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE title IS NOT NULL');
app.get('/taggings.json', async (c) => {
    return c.json(taggingsStmt.all());
});

const unreadEntriesStmt = db.query<{ id: number; }, []>('SELECT id FROM Item WHERE read=0');
const updatEntriesReadStmt = db.query<{ id: number; }, [read: boolean, idsJSON: string]>('UPDATE Item SET read=? WHERE id IN (SELECT value from json_each(?,"$.unread_entries")) RETURNING id');
app.get('/unread_entries.json', async (c) => {
    return c.json(unreadEntriesStmt.all().map(({ id }) => id));
}).post(async (c) => {
    return c.json(updatEntriesReadStmt.all(false, await c.req.text()).map(({ id }) => id));
}).delete(async (c) => {
    return c.json(updatEntriesReadStmt.all(true, await c.req.text()).map(({ id }) => id));
});

const starredEntriesStmt = db.query<{ id: number; }, []>('SELECT id FROM Item WHERE star=1');
const updatEntriesStarStmt = db.query<{ id: number; }, [star: boolean, idsJSON: string]>('UPDATE Item SET star=? WHERE id IN (SELECT value from json_each(?,"$.starred_entries")) RETURNING id');
app.get('/starred_entries.json', async (c) => {
    return c.json(starredEntriesStmt.all().map(({ id }) => id));
}).post(async (c) => {
    return c.json(updatEntriesStarStmt.all(true, await c.req.text()).map(({ id }) => id));
}).delete(async (c) => {
    return c.json(updatEntriesStarStmt.all(false, await c.req.text()).map(({ id }) => id));
});

const entriesStmt = db.query<unknown, [{
    read: boolean | null;
    star: boolean | null;
    limit: number;
    offset: number;
}]>(
    'SELECT Item.id, Feed.id feedId, Item.title, Item.url, (SELECT group_concat(json_extract(value,"$.name"),", ") from json_each(authors)) author, contentHtml, ifnull(Item.datePublished, Item.createdAt) publishedAt, createdAt FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id LEFT JOIN Category ON Feed.categoryId=Category.id WHERE ifnull(read=$read,1) AND ifnull(star=$star,1) AND Feed.title IS NOT NULL ORDER BY Item.id DESC LIMIT $limit OFFSET $offset'
).as(class {
    declare id: number;
    declare feedId: number;
    declare title: string | null;
    declare url: string | null;
    declare author: string | null;
    declare contentHtml: string | null;
    declare private publishedAt: number;
    declare private createdAt: number;

    toJSON() {
        return {
            id: this.id,
            feed_id: this.feedId,
            title: this.title,
            url: this.url,
            author: this.author,
            summary: null,
            content: this.contentHtml,
            published: new Date(this.publishedAt * 1000).toISOString(),
            created_at: new Date(this.createdAt * 1000).toISOString(),
        };
    }
});
app.get('/entries.json', zValidator('query', z.object({
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

export default app;
