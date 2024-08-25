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
    return c.text('OK', 200);
});

const subscriptionsStmt = db.query<{
    id: number;
    feed_id: number;
    feed_url: string;
    site_url: string;
}, []>('SELECT id, id feed_id, title, url feed_url, homePage site_url FROM FeedView');
app.get('/subscriptions.json', async (c) => {
    const feeds = subscriptionsStmt.all();
    return c.json(feeds);
});

const taggingsStmt = db.query<{
    id: number;
    feed_id: number;
    name: string;
}, []>('SELECT categoryId id, id feed_id, category name FROM FeedView');
app.get('/taggings.json', async (c) => {
    const taggings = taggingsStmt.all();
    return c.json(taggings);
});

const unreadEntriesStmt = db.query<{ id: number; }, []>('SELECT id FROM ItemView WHERE read=0');
app.get('/unread_entries.json', async (c) => {
    const entries = unreadEntriesStmt.all();
    return c.json(entries.map(({ id }) => id));
}).post(zValidator('json', z.object({
    unread_entries: z.coerce.number().int().positive().array(),
})), async (c) => {
    const { unread_entries } = c.req.valid('json');
    const entries = db.prepare<{ id: number; }, []>(`UPDATE ItemView SET read=0 WHERE id IN (${unread_entries}) RETURNING id`).all();
    return c.json(entries.map(({ id }) => id));
}).delete(zValidator('json', z.object({
    unread_entries: z.coerce.number().int().positive().array(),
})), async (c) => {
    const { unread_entries } = c.req.valid('json');
    const entries = db.prepare<{ id: number; }, []>(`UPDATE ItemView SET read=1 WHERE id IN (${unread_entries}) RETURNING id`).all();
    return c.json(entries.map(({ id }) => id));
});

const starredEntriesStmt = db.query<{ id: number; }, []>('SELECT id FROM ItemView WHERE star=1');
app.get('/starred_entries.json', async (c) => {
    const entries = starredEntriesStmt.all();
    return c.json(entries.map(({ id }) => id));
}).post(zValidator('json', z.object({
    starred_entries: z.coerce.number().int().positive().array(),
})), async (c) => {
    const { starred_entries } = c.req.valid('json');
    const entries = db.prepare<{ id: number; }, []>(`UPDATE ItemView SET star=1 WHERE id IN (${starred_entries}) RETURNING id`).all();
    return c.json(entries.map(({ id }) => id));
}).delete(zValidator('json', z.object({
    starred_entries: z.coerce.number().int().positive().array(),
})), async (c) => {
    const { starred_entries } = c.req.valid('json');
    const entries = db.prepare<{ id: number; }, []>(`UPDATE ItemView SET star=0 WHERE id IN (${starred_entries}) RETURNING id`).all();
    return c.json(entries.map(({ id }) => id));
});

const entriesStmt = db.query<unknown, [{
    read: boolean | null;
    star: boolean | null;
    limit: number;
    offset: number;
}]>(
    'SELECT id, feedId feed_id, title, url, authors, contentHtml content, publishedAt, createdAt FROM ItemView WHERE ifnull(read=$read,1) AND ifnull(star=$star,1) ORDER BY id DESC LIMIT $limit OFFSET $offset'
).as(class {
    declare id: number;
    declare feed_id: number;
    declare title: string | null;
    declare url: string | null;
    declare private authors: string | null;
    declare content: string | null;
    declare private publishedAt: number;
    declare private createdAt: number;

    get author() {
        if (this.authors)
            return (JSON.parse(this.authors) as { name: string; }[])
                .map(({ name }) => name).join(', ');
        return null;
    }
    get published() {
        return new Date(this.publishedAt * 1000).toISOString();
    }
    get created_at() {
        return new Date(this.createdAt * 1000).toISOString();
    }
    toJSON() {
        const {
            id,
            feed_id,
            title,
            author,
            content,
            url,
            published,
            created_at,
        } = this;
        return {
            id,
            feed_id,
            title,
            url,
            author,
            summary: null,
            content,
            published,
            created_at,
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
    const entries = entriesStmt.all(c.req.valid('query'));
    return c.json(entries);
});

export default app;
