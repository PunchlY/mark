// https://github.com/theoldreader/api
// https://github.com/FreshRSS/FreshRSS/blob/edge/p/api/greader.php

import { Elysia, InvertedStatusMap, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import db from 'db';
import { User } from 'db/user';


const idSchema = t.Transform(t.TemplateLiteral([t.Literal('tag:google.com,2005:reader/item/'), t.Numeric({ multipleOf: 16 })]))
    .Decode((s) => parseInt(s.substring(32), 16))
    .Encode((id) => `tag:google.com,2005:reader/item/${id.toString(16) as any}`);

const tagsStmt = db.query<{ label: string; }, []>('SELECT name label FROM Category');
const subscriptionsStmt = db.query<{ id: number, title: string, url: string, htmlUrl: string, label: string; }, []>(
    'SELECT Feed.id, title, url, homePage htmlUrl, name label FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE title IS NOT NULL'
);

class Item {
    declare id: number;
    declare title: string | null;
    declare url: string | null;
    declare authors: string | null;
    declare contentHtml: string | null;
    declare publishedAt: number;
    declare createdAt: number;
    declare read: 0 | 1;
    declare star: 0 | 1;
    declare feedId: number;
    declare feedTitle: string;
    declare category: string;
    declare homePage: string | null;

    get author() {
        return this.authors ? (JSON.parse(this.authors) as { name: string; }[]).map(({ name }) => name).join(', ') : null;
    }
    toJSON() {
        const categories = ['user/-/state/com.google/reading-list', `user/-/label/${this.category}`];
        if (this.star)
            categories.push('user/-/state/com.google/starred');
        if (this.read)
            categories.push('user/-/state/com.google/read');
        return {
            id: `tag:google.com,2005:reader/item/${this.id.toString(16).padStart(16, '0')}`,
            categories,
            title: this.title,
            crawlTimeMsec: `${this.createdAt}000`,
            timestampUsec: `${this.publishedAt}000000`,
            published: this.publishedAt,
            author: this.author,
            alternate: [{ href: this.url }],
            summary: { content: this.contentHtml },
            content: { content: this.contentHtml },
            origin: {
                streamId: `feed/${this.feedId.toString(16).padStart(16, '0')}`,
                title: this.feedTitle,
                htmlUrl: this.homePage,
            },
            canonical: [{ href: this.url }],
        };
    }
}

const streamSuery = <T>(column: string) => {
    return db.query<T, {
        n: number;
        read: boolean | null;
        star: boolean | null;
        category: string | null;
        feedId: number | null;
        nt: number | null;
        ot: number | null;
        r: boolean;
        c: number | null;
    }>(`SELECT ${column} FROM (SELECT Item.id, Item.url, Item.title, Item.authors, Item.contentHtml, ifnull(Item.datePublished, Item.createdAt) publishedAt, Item.createdAt, Item.read, Item.star, Feed.id feedId, Feed.title feedTitle, Feed.url feedUrl, Feed.homePage, Category.id categoryId, Category.name category FROM Item LEFT JOIN Feed ON Item.feedId = Feed.id LEFT JOIN Category ON Feed.categoryId = Category.id WHERE Feed.title IS NOT NULL AND ifnull(read=$read,1) AND ifnull(star=$star,1) AND ifnull(category=$category,1) AND ifnull(feedId=$feedId,1) AND ifnull(publishedAt<=$nt,1) AND ifnull(publishedAt>=$ot,1) AND ifnull(iif($r,Item.id>=$c,Item.id<=$c),1) ORDER BY iif($r,Item.id,null) ASC, iif($r,null,Item.id) DESC LIMIT $n+1)`);
};

const idsStmt = streamSuery<{ id: number; }>('id');

const contentsStmt = streamSuery('id, url, title, authors, contentHtml, publishedAt, createdAt, read, star, feedId, feedTitle, homePage, category').as(Item);

const itemsContentsStmt = db.query<unknown, [idsJSON: string]>(`SELECT Item.id, Item.url, Item.title, authors, Item.contentHtml, ifnull(Item.datePublished, Item.createdAt) publishedAt, Item.createdAt, Item.read, Item.star, Feed.id feedId, Feed.title feedTitle, Feed.url feedUrl, Feed.homePage, Category.id categoryId, Category.name category FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id LEFT JOIN Category ON Feed.categoryId=Category.id WHERE Feed.title IS NOT NULL AND Item.id IN (SELECT value from json_each(?))`).as(Item);

const editTagStmt = db.query<null, [read: boolean | null, star: boolean | null, idsJSON: string]>(`UPDATE Item SET read=ifnull(?,read),star=ifnull(?,star) WHERE id IN (SELECT value from json_each(?))`);

class AuthError extends Error { }

export default new Elysia({ name: 'greader', prefix: '/greader' })
    .error({ AUTH_ERROR: AuthError })
    .use(jwt({
        secret: `${Date()} ${Math.random()}`,
        exp: '3h',
        schema: t.Object({ Email: t.String() }),
    }))
    .post('/accounts/ClientLogin', async ({ jwt, body: { Email, Passwd }, error }) => {
        if (!await User.verify(Email, Passwd))
            return error(401);
        const token = await jwt.sign({ Email });
        return `SID=${token}\nLSID=none\nAuth=${token}`;
    }, { body: t.Object({ Email: t.String(), Passwd: t.String() }) })
    .state('token', null as null | string)
    .state('username', null as null | string)
    .group('/reader/api/0', {
        async transform({ jwt, store, request: { method, headers } }) {
            if (process.env.NODE_ENV !== 'production')
                return;
            if (method === 'OPTIONS')
                return;
            const auth = headers.get('Authorization');
            if (auth && auth.startsWith('GoogleLogin auth=')) {
                const token = auth.substring(17);
                const res = await jwt.verify(token);
                if (res && await User.has(res.Email)) {
                    store.token = token;
                    store.username = res.Email;
                    return;
                }
            }
            throw new AuthError();
        },
        error({ code, set }) {
            if (code === 'AUTH_ERROR') {
                set.status = 401;
                return InvertedStatusMap[401];
            }
        },
    }, (app) => app
        .get('/user-info', ({ store: { username } }) => {
            return {
                userId: '1',
                userName: username!,
                userProfileId: '1',
                userEmail: username!,
            };
        })
        .get('/token', ({ store: { token } }) => token!)
        .get('/tag/list', () => {
            const tags = tagsStmt.all();
            return {
                tags: [
                    { id: 'user/-/state/com.google/starred' },
                    ...tags.map(({ label }) => {
                        return {
                            id: `user/-/label/${label}`,
                            label,
                            type: 'folder',
                        };
                    }),
                ],
            };
        })
        .get('/subscription/list', () => {
            const subscriptions = subscriptionsStmt.all();
            return {
                subscriptions: subscriptions.map(({
                    id,
                    title,
                    url,
                    htmlUrl,
                    label,
                }) => {
                    return {
                        id: `feed/${id.toString(16).padStart(16, '0')}`,
                        title,
                        categories: [{
                            id: `user/-/label/${label}`,
                            label,
                            type: 'folder',
                        }],
                        url,
                        htmlUrl,
                    };
                }),
            };
        })
        .guard({
            query: t.Object({
                n: t.Numeric({ minimum: 0, default: 10 }),
                s: t.Optional(t.Union([
                    t.Transform(t.Literal('user/-/state/com.google/reading-list'))
                        .Decode(() => undefined)
                        .Encode(() => 'user/-/state/com.google/reading-list'),
                    t.Transform(t.Literal('user/-/state/com.google/read'))
                        .Decode(() => ({ read: true }))
                        .Encode(() => 'user/-/state/com.google/read'),
                    t.Transform(t.Literal('user/-/state/com.google/starred'))
                        .Decode(() => ({ star: true }))
                        .Encode(() => 'user/-/state/com.google/starred'),
                    t.Transform(t.String({ pattern: '^user\\/-\\/label\\/(?:.+)$' }))
                        .Decode((s) => ({ category: s.substring(13) }))
                        .Encode(({ category }) => `user/-/label/${category}`),
                    t.Transform(t.String({ pattern: '^feed\\/(?:[0-9a-fA-F]+)$' }))
                        .Decode((s) => ({ feedId: parseInt(s.substring(5), 16) }))
                        .Encode(({ feedId }) => `feed/${feedId}`),
                    t.Undefined(),
                ])),
                xt: t.Optional(t.Union([
                    t.Transform(t.Literal('user/-/state/com.google/read'))
                        .Decode(() => ({ read: false }))
                        .Encode(() => 'user/-/state/com.google/read'),
                    t.Undefined(),
                ])),
                r: t.Optional(t.Literal('o')),
                c: t.Optional(t.Numeric({ minimum: 0 })),
                nt: t.Optional(t.Numeric({ minimum: 0 })),
                ot: t.Optional(t.Numeric({ minimum: 0 })),
            }),
        }, (app) => app
            .get('/stream/items/ids', ({ query: { n, s, xt, nt, ot, r, c } }) => {
                const itemRefs = idsStmt.all({
                    n,
                    read: s && 'read' in s ? s.read : null,
                    star: s && 'star' in s ? s.star : null,
                    category: s && 'category' in s ? s.category : null,
                    feedId: s && 'feedId' in s ? s.feedId : null,
                    ...xt,
                    nt: nt ?? null,
                    ot: ot ?? null,
                    r: r === 'o',
                    c: c ?? null,
                });
                const data: {
                    itemRefs: { id: string; }[];
                    continuation?: string;
                } = {
                    itemRefs: itemRefs.map(({ id }) => {
                        return { id: String(id) };
                    }),
                };
                if (itemRefs.length > n) {
                    data.continuation = String(itemRefs[n].id);
                    itemRefs.length = n;
                }
                return data;
            })
            .get('/stream/contents', ({ query: { n, s, xt, nt, ot, r, c } }) => {
                const items = contentsStmt.all({
                    n,
                    read: s && 'read' in s ? s.read : null,
                    star: s && 'star' in s ? s.star : null,
                    category: s && 'category' in s ? s.category : null,
                    feedId: s && 'feedId' in s ? s.feedId : null,
                    ...xt,
                    nt: nt ?? null,
                    ot: ot ?? null,
                    r: r === 'o',
                    c: c ?? null,
                });
                return {
                    id: 'user/-/state/com.google/reading-list',
                    updated: new Date().getTime() / 1000 | 0,
                    items,
                    continuation: items.length > n ? items.pop()!.id : undefined,
                };
            })
        )
        .post('/stream/items/contents', ({ body: { i } }) => {
            const items = itemsContentsStmt.all(JSON.stringify(i));
            return {
                id: 'user/-/state/com.google/reading-list',
                updated: new Date().getTime() / 1000 | 0,
                items,
            };
        }, {
            body: t.Object({
                i: t.Union([t.Array(idSchema), idSchema, t.Array(t.Numeric()), t.Numeric()]),
            }),
        })
        .post('/edit-tag', ({ body: { i, a, r }, set }) => {
            const { read, star } = { ...a, ...r } as { read?: boolean, star?: boolean; };
            editTagStmt.run(read ?? null, star ?? null, JSON.stringify(i));
            set.status = 204;
        }, {
            body: t.Object({
                i: t.Union([t.Array(idSchema), idSchema, t.Array(t.Numeric()), t.Numeric()]),
                a: t.Optional(t.Union([
                    t.Transform(t.Literal('user/-/state/com.google/read'))
                        .Decode(() => ({ read: true }))
                        .Encode(() => 'user/-/state/com.google/read'),
                    t.Transform(t.Literal('user/-/state/com.google/starred'))
                        .Decode(() => ({ star: true }))
                        .Encode(() => 'user/-/state/com.google/starred'),
                    t.Undefined(),
                ])),
                r: t.Optional(t.Union([
                    t.Transform(t.Literal('user/-/state/com.google/read'))
                        .Decode(() => ({ read: false }))
                        .Encode(() => 'user/-/state/com.google/read'),
                    t.Transform(t.Literal('user/-/state/com.google/starred'))
                        .Decode(() => ({ star: false }))
                        .Encode(() => 'user/-/state/com.google/starred'),
                    t.Undefined(),
                ])),
            }),
        })
    );
