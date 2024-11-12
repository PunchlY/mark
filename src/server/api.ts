import { Hono, type Context } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import db from 'db';
import { atom } from 'lib/view';
import { type Subscribe } from 'subscribe';

class Feed {
    declare id: number;
    declare title: string | null;
    declare url: string | null;
    declare homePage: string | null;
    declare refresh: number | null;
    declare markRead: number | null;
    declare clean: number | null;
    declare plugins: string | null;
    declare category: string;
    toJSON() {
        const { plugins, ...data } = this;
        return {
            ...data,
            plugins: plugins && JSON.parse(plugins),
        };
    }
}

const categoriesStmt = db.query<{ name: string; }, []>('SELECT name FROM Category');
const findCategoryStmt = db.query<{ id: number; }, [name: string]>(`SELECT id FROM Category WHERE name=?`);
const insertCategoryStmt = db.query<{ id: number; }, [name: string]>(`INSERT INTO Category (name) VALUES (?) RETURNING id`);

const feedsStmt = db.query<unknown, []>('SELECT Feed.id, title, url, homePage, refresh, markRead, clean, plugins, name category FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id').as(Feed);
const insertFeedStmt = db.query<{ id: number; }, [url: string, categoryId: number]>(`INSERT INTO Feed (url,categoryId) VALUES (?,?) RETURNING id`);
const insertFeed = db.transaction((url: string, category?: string) => {
    category ||= 'Uncategorized';
    const categoryId = findCategoryStmt.get(category)?.id ?? insertCategoryStmt.get(category)?.id!;
    const { id } = insertFeedStmt.get(url, categoryId)!;
    return id;
});
const feedStmt = db.query<unknown, [feedId: number]>('SELECT Feed.id, title, url, homePage, refresh, markRead, clean, plugins, name category FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE Feed.id=?').as(Feed);
const deleteFeedStmt = db.query<{ id: number; }, [feedId: number]>(`DELETE FROM Feed WHERE id=? RETURNING id`);
const updateFeedStmt = db.query<null, { id: number, url: string | null, categoryId: number | null, refresh: number | null, markRead: number | null, clean: number | null, plugins: string | null; }>(`UPDATE Feed SET url=ifnull($url,url),categoryId=ifnull($categoryId,categoryId),refresh=ifnull($refresh,refresh),markRead=ifnull($markRead,markRead),clean=ifnull($clean,clean),plugins=ifnull($plugins,plugins) WHERE id=$id`);
const updateFeed = db.transaction((id: number, { category, ...data }: { url: string | null, category?: string, refresh: number | null, markRead: number | null, clean: number | null, plugins: string | null; }) => {
    let categoryId = null;
    if (category)
        categoryId = findCategoryStmt.get(category)?.id ?? insertCategoryStmt.get(category)?.id!;
    updateFeedStmt.get({ id, categoryId, ...data });
});

export default new Hono<{ Bindings: Bindings; }>()
    .use(basicAuth({
        verifyUser(username, password, c: Context<{ Bindings: Bindings; }>) {
            return username === c.env.EMAIL && password === c.env.PASSWORD;
        },
    }))
    .get('/categories', async (c) => {
        return c.json(categoriesStmt.all());
    })
    .get('/feeds', async (c) => {
        return c.json(feedsStmt.all());
    })
    .post('/feeds', zValidator('json', z.object({
        url: z.string().url(),
        category: z.string().transform((s) => s.trim()).optional(),
    })), async (c) => {
        const { url, category } = c.req.valid('json');
        return c.json(insertFeed(url, category));
    })
    .get('/feeds/:id{[1-9][0-9]*}', async (c) => {
        const feed = feedStmt.get(Number(c.req.param('id')));
        if (!feed)
            return c.notFound();
        return c.json(feed);
    })
    .put('/feeds/:id{[1-9][0-9]*}', async (c) => {
        await c.env.SUBSCRIBE.refresh(Number(c.req.param('id')));
        return c.json(true);
    })
    .patch('/feeds/:id{[1-9][0-9]*}', zValidator('json', z.object({
        url: z.string().url().optional().transform((url) => url || null),
        category: z.string().transform((s) => s.trim()).optional(),
        refresh: z.number().positive().nullish().transform((refresh) => refresh === null ? 0 : refresh ?? null),
        markRead: z.number().positive().nullish().transform((markRead) => markRead === null ? 0 : markRead ?? null),
        clean: z.number().positive().nullish().transform((clean) => clean === null ? 0 : clean ?? null),
        plugins: z.object({
            fetch: z.any().refine((fetch) => typeof fetch === 'object' && Object.values(fetch).every((v) => typeof v === 'string')).optional(),
            rewrite: z.any().refine((rewrite) => typeof rewrite === 'object' && Object.values(rewrite).every((v) => typeof v === 'string')).optional(),
        }).transform((plugin) => JSON.stringify(plugin)).nullish().transform((plugin) => plugin === null ? '{}' : plugin ?? null),
    })), async (c) => {
        updateFeed(Number(c.req.param('id')), c.req.valid('json'));
        return c.json(true);
    })
    .delete('/feeds/:id{[1-9][0-9]*}', async (c) => {
        const id = Number(c.req.param('id'));
        if (!deleteFeedStmt.get(id))
            return c.notFound();
        return c.json(true);
    })
    .get('/options', async (c) => {
        return c.json(c.env.SUBSCRIBE.options);
    })
    .get('/test', zValidator('query', z.object({
        url: z.string().url(),
        format: z.enum(['atom', 'json']).default('atom'),
    }).passthrough().transform(({ url, format, ...data }) => {
        const plugins: Subscribe.Plugins = {};
        for (const [key, value] of Object.entries(data as Record<string, string>)) {
            if (key.startsWith('fetch:'))
                (plugins.fetch ??= {})[key.slice(6)] = value;
            else if (key.startsWith('rewrite:'))
                (plugins.rewrite ??= {})[key.slice(8)] = value;
        }
        return { url, format, plugins };
    })), async (c) => {
        const { url, format, plugins } = c.req.valid('query');
        const feed = await c.env.SUBSCRIBE.test(url, plugins);
        switch (format) {
            case 'json':
                return c.json(feed, 200, { 'Content-Type': 'application/feed+json; charset=UTF-8' });
            case 'atom':
            default:
                return c.body(await atom(feed), 200, { 'Content-Type': 'text/xml; charset=UTF-8' });
        }
    });
