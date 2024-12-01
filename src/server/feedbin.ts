// https://github.com/feedbin/feedbin-api

import { Elysia, t } from 'elysia';
import db from 'db';
import basicAuth from './basic';

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

const entriesStmt = db.query<unknown, [{ read: boolean | null, star: boolean | null, limit: number, offset: number; }]>(
    'SELECT Item.id, Feed.id feed_id, Item.title, Item.url, authors, contentHtml content, ifnull(Item.datePublished, Item.createdAt) publishedAt, createdAt FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id LEFT JOIN Category ON Feed.categoryId=Category.id WHERE ifnull(read=$read,1) AND ifnull(star=$star,1) AND Feed.title IS NOT NULL ORDER BY Item.id DESC LIMIT $limit OFFSET $offset'
).as(class {
    declare id: number;
    declare feed_id: number;
    declare title: string | null;
    declare url: string | null;
    declare authors: string | null;
    declare content: string | null;
    declare publishedAt: number;
    declare createdAt: number;

    toJSON() {
        const { publishedAt, createdAt, authors, ...data } = this;
        return {
            ...data,
            author: authors ? (JSON.parse(authors) as { name: string; }[]).map(({ name }) => name).join(', ') : null,
            summary: null,
            published: new Date(publishedAt * 1000).toISOString(),
            created_at: new Date(createdAt * 1000).toISOString(),
        };
    }
});

export default new Elysia({ name: 'feedbin', prefix: '/feedbin' })
    .group('/v2', (app) => app.use(basicAuth)
        .get('/authentication.json', () => true)
        .get('/subscriptions.json', () => subscriptionsStmt.all())
        .get('/taggings.json', () => taggingsStmt.all())
        .get('/unread_entries.json', () => unreadEntriesStmt.all().map(({ id }) => id))
        .guard({
            body: t.Object({
                unread_entries: t.Array(t.Numeric({ minimum: 1 })),
            }),
        }, (app) => app
            .post('/unread_entries.json', ({ body: { unread_entries } }) => {
                return updatEntriesReadStmt.all(false, JSON.stringify(unread_entries)).map(({ id }) => id);
            })
            .delete('/unread_entries.json', ({ body: { unread_entries } }) => {
                return updatEntriesReadStmt.all(true, JSON.stringify(unread_entries)).map(({ id }) => id);
            })
        )
        .get('/starred_entries.json', () => {
            return starredEntriesStmt.all().map(({ id }) => id);
        })
        .guard({
            body: t.Object({
                starred_entries: t.Array(t.Numeric({ minimum: 1 })),
            }),
        }, (app) => app
            .post('/starred_entries.json', ({ body: { starred_entries } }) => {
                return updatEntriesStarStmt.all(true, JSON.stringify(starred_entries)).map(({ id }) => id);
            })
            .delete('/starred_entries.json', ({ body: { starred_entries } }) => {
                return updatEntriesStarStmt.all(false, JSON.stringify(starred_entries)).map(({ id }) => id);
            })
        )
        .get('/entries.json', ({ query: { page, read, starred, per_page } }) => {
            return entriesStmt.all({
                read: read ?? null,
                star: starred ?? null,
                limit: per_page,
                offset: (page - 1) * per_page,
            });
        }, {
            query: t.Object({
                page: t.Numeric({ minimum: 1, default: 1 }),
                read: t.Optional(t.BooleanString()),
                starred: t.Optional(t.BooleanString()),
                per_page: t.Numeric({ minimum: 1, default: 10 }),
            }),
        })
    );
