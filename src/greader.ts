// https://github.com/theoldreader/api
// https://github.com/FreshRSS/FreshRSS/blob/edge/p/api/greader.php

import { Type, type StaticDecode } from '@sinclair/typebox';
import { empty, join, sql } from './db';
import { Body, Route, Mount, Store, Hook, Query, Controller } from 'router';
import { JWT } from './jwt';
import { HTTPResponseError } from './error';

export namespace Module {
    export type Login = StaticDecode<typeof Login>;
    export const Login = Type.Object({
        Email: Type.String(),
        Passwd: Type.String(),
    });

    export type Search = StaticDecode<typeof Search>;
    export const Search = Type.Transform(Type.Object({
        n: Type.Integer({ minimum: 0, default: 10 }),
        s: Type.Optional(Type.Union([
            Type.Transform(Type.Literal('user/-/state/com.google/reading-list'))
                .Decode(() => undefined)
                .Encode(() => 'user/-/state/com.google/reading-list'),
            Type.Transform(Type.Literal('user/-/state/com.google/read'))
                .Decode(() => ({ read: true }))
                .Encode(() => 'user/-/state/com.google/read'),
            Type.Transform(Type.Literal('user/-/state/com.google/starred'))
                .Decode(() => ({ star: true }))
                .Encode(() => 'user/-/state/com.google/starred'),
            Type.Transform(Type.String({ pattern: '^user\\/-\\/label\\/(?:.+)$' }))
                .Decode((s) => ({ category: s.substring(13) }))
                .Encode(({ category }) => `user/-/label/${category}`),
            Type.Transform(Type.String({ pattern: '^feed\\/(?:[0-9a-fA-F]+)$' }))
                .Decode((s) => ({ feedId: parseInt(s.substring(5), 16) }))
                .Encode(({ feedId }) => `feed/${feedId}`),
            Type.Undefined(),
        ])),
        xt: Type.Optional(Type.Union([
            Type.Transform(Type.Literal('user/-/state/com.google/read'))
                .Decode(() => ({ read: false }))
                .Encode(() => 'user/-/state/com.google/read'),
            Type.Undefined(),
        ])),
        r: Type.Optional(Type.Literal('o')),
        c: Type.Optional(Type.Integer({ minimum: 0 })),
        nt: Type.Optional(Type.Integer({ minimum: 0 })),
        ot: Type.Optional(Type.Integer({ minimum: 0 })),
    }))
        .Decode(({ s, xt, ...data }) => {
            const { read, star, category, feedId } = { ...s, ...xt } as { read?: boolean, star?: boolean, category?: string, feedId?: number; };
            return { ...data, read, star, category, feedId };
        })
        .Encode(() => { throw new Error(); });

    export class Item {
        declare id: number;
        declare title: string | null;
        declare url: string | null;
        declare author: string | null;
        declare contentHtml: string | null;
        declare publishedAt: number;
        declare createdAt: number;
        declare read: 0 | 1;
        declare star: 0 | 1;
        declare feedId: number;
        declare feedTitle: string;
        declare category: string;
        declare homePage: string | null;

        toJSON() {
            const categories = ['user/-/state/com.google/reading-list', `user/-/label/${this.category}`];
            if (this.star)
                categories.push('user/-/state/com.google/starred');
            if (this.read)
                categories.push('user/-/state/com.google/read');
            return {
                id: `tag:google.com,2005:reader/item/${this.id.toString(16).padStart(16, '0')}`,
                categories,
                title: this.title ?? '',
                crawlTimeMsec: `${this.createdAt}000`,
                timestampUsec: `${this.publishedAt}000000`,
                published: this.publishedAt,
                author: this.author,
                alternate: [{ href: this.url ?? '' }],
                summary: { content: this.contentHtml },
                content: { content: this.contentHtml },
                origin: {
                    streamId: `feed/${this.feedId.toString(16).padStart(16, '0')}`,
                    title: this.feedTitle,
                    htmlUrl: this.homePage,
                },
                canonical: [{ href: this.url ?? '' }],
            };
        }
    }

    const idSchema = Type.Transform(Type.String({ pattern: '^tag:google.com,2005:reader/item/[0-9a-fA-F]+$' }))
        .Decode((s) => parseInt(s.substring(32), 16))
        .Encode((id) => `tag:google.com,2005:reader/item/${id.toString(16)}`);

    export type Ids = StaticDecode<typeof Ids>;
    export const Ids = Type.Object({
        i: Type.Array(idSchema),
    });

    export type EditIds = StaticDecode<typeof EditIds>;
    export const EditIds = Type.Composite([
        Ids,
        Type.Object({
            a: Type.Optional(Type.Union([
                Type.Transform(Type.Literal('user/-/state/com.google/read'))
                    .Decode(() => ({ read: true }))
                    .Encode(() => 'user/-/state/com.google/read'),
                Type.Transform(Type.Literal('user/-/state/com.google/starred'))
                    .Decode(() => ({ star: true }))
                    .Encode(() => 'user/-/state/com.google/starred'),
                Type.Undefined(),
            ])),
            r: Type.Optional(Type.Union([
                Type.Transform(Type.Literal('user/-/state/com.google/read'))
                    .Decode(() => ({ read: false }))
                    .Encode(() => 'user/-/state/com.google/read'),
                Type.Transform(Type.Literal('user/-/state/com.google/starred'))
                    .Decode(() => ({ star: false }))
                    .Encode(() => 'user/-/state/com.google/starred'),
                Type.Undefined(),
            ])),
        }),
    ]);
}

@Controller()
class Reader {
    @Hook('beforeHandle')
    async online({ method, headers }: Request, jwt: JWT<{ Email: string; }>, store: Store<{ token: string, username: string; }>) {
        if (method === 'OPTIONS')
            return;
        const auth = headers.get('Authorization');
        if (auth && auth.startsWith('GoogleLogin auth=')) try {
            const token = auth.substring(17);
            const { Email: username } = await jwt.verify(token);
            if (username === Bun.env.EMAIL) {
                store.token = token;
                store.username = username;
                return;
            }
        } catch { }
        throw new HTTPResponseError('Unauthorized', { status: 401 });
    }
    @Route('GET', '/user-info')
    user(@Store('username') username: string) {
        return {
            userId: '1',
            userName: username,
            userProfileId: '1',
            userEmail: username,
        };
    }
    @Route('GET', '/token')
    token(@Store('token') token: string) {
        return token;
    }

    @Route('GET', '/tag/list')
    tags() {
        return {
            tags: [
                { id: 'user/-/state/com.google/starred' },
                ...sql`SELECT category label FROM Feed GROUP BY category`
                    .iterate<{ label: string; }>()
                    .map(({ label }) => {
                        return {
                            id: `user/-/label/${label}`,
                            label,
                            type: 'folder',
                        };
                    }),
            ],
        };
    }

    @Route('GET', '/subscription/list')
    subscriptions() {
        return {
            subscriptions: sql`SELECT id, title, url, homePage htmlUrl, category label FROM Feed WHERE title IS NOT NULL`
                .iterate<{ id: number, title: string, url: string, htmlUrl: string, label: string; }>()
                .map(({
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
                }).toArray(),
        };
    }

    @Route('GET', '/stream/items/ids')
    ids(@Query() { n, nt, ot, r, c, read, star, category, feedId }: Module.Search) {
        let continuation;
        const itemRefs = sql`
            SELECT
                Item.id,
                ifnull(Item.datePublished, Item.createdAt) publishedAt
            FROM Item
            LEFT JOIN Feed ON Item.feedId = Feed.id
            WHERE ${join([
            sql`Feed.title IS NOT NULL`,
            typeof read === 'undefined' ? empty : sql`read=${read}`,
            typeof star === 'undefined' ? empty : sql`star=${star}`,
            typeof category === 'undefined' ? empty : sql`category=${category}`,
            typeof feedId === 'undefined' ? empty : sql`feedId=${feedId}`,
            typeof nt === 'undefined' ? empty : sql`publishedAt<=${nt}`,
            typeof ot === 'undefined' ? empty : sql`publishedAt>=${ot}`,
            typeof c === 'undefined' ? empty : r === 'o' ? sql`Item.id>=${c}` : sql`Item.id<=${c}`,
        ], ' AND ')}
            ORDER BY
                ${r === 'o' ? sql`Item.id ASC` : sql`Item.id DESC`}
            LIMIT ${n + 1}`
            .iterate<{ id: number, publishedAt: number; }>().map(({ id }) => ({ id: String(id) }))
            .toArray();
        if (itemRefs.length > n) {
            continuation = String(itemRefs[n].id);
            itemRefs.length = n;
        }
        return { itemRefs, continuation };
    }

    @Route('GET', '/stream/contents')
    contents(@Query() { n, nt, ot, r, c, read, star, category, feedId }: Module.Search) {
        const items = sql`
        SELECT
            Item.id,
            Item.url, 
            Item.title,
            Item.author,
            Item.contentHtml,
            ifnull(Item.datePublished, Item.createdAt) publishedAt,
            Item.createdAt,
            Item.read,
            Item.star,
            Feed.id feedId,
            Feed.title feedTitle,
            Feed.homePage,
            Feed.category
        FROM Item
        LEFT JOIN Feed ON Item.feedId = Feed.id
        WHERE ${join([
            sql`Feed.title IS NOT NULL`,
            typeof read === 'undefined' ? empty : sql`read=${read}`,
            typeof star === 'undefined' ? empty : sql`star=${star}`,
            typeof category === 'undefined' ? empty : sql`category=${category}`,
            typeof feedId === 'undefined' ? empty : sql`feedId=${feedId}`,
            typeof nt === 'undefined' ? empty : sql`publishedAt<=${nt}`,
            typeof ot === 'undefined' ? empty : sql`publishedAt>=${ot}`,
            typeof c === 'undefined' ? empty : r === 'o' ? sql`Item.id>=${c}` : sql`Item.id<=${c}`,
        ], ' AND ')}
        ORDER BY ${r === 'o' ? sql`Item.id ASC` : sql`Item.id DESC`}
        LIMIT ${n + 1}`
            .all(Module.Item);
        return {
            id: 'user/-/state/com.google/reading-list',
            updated: new Date().getTime() / 1000 | 0,
            items,
            continuation: items.length > n ? items.pop()!.id : undefined,
        };
    }

    @Route('POST', '/stream/items/contents')
    itemsContents(@Body() { i }: Module.Ids) {
        const items = sql`
        SELECT
            Item.id,
            Item.url,
            Item.title,
            Item.author,
            Item.contentHtml,
            ifnull(Item.datePublished, Item.createdAt) publishedAt,
            Item.createdAt,
            Item.read,
            Item.star,
            Feed.id feedId,
            Feed.title feedTitle,
            Feed.url feedUrl,
            Feed.homePage,
            Feed.category
        FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id
        WHERE
            Feed.title IS NOT NULL
            AND Item.id IN (
                SELECT value from json_each(${JSON.stringify(i)})
            )`
            .all(Module.Item);
        return {
            id: 'user/-/state/com.google/reading-list',
            updated: new Date().getTime() / 1000 | 0,
            items,
        };
    }

    @Route('POST', '/edit-tag', { status: 204 })
    editTag(@Body() { i, a, r }: Module.EditIds) {
        const { read, star } = { ...a, ...r } as { read?: boolean, star?: boolean; };
        if (typeof read === undefined && typeof star === 'undefined')
            return null;
        sql`
        UPDATE Item
        SET ${join([
            typeof read === 'undefined' ? empty : sql`read=${read}`,
            typeof star === 'undefined' ? empty : sql`star=${star}`,
        ])}
        WHERE
            id IN (SELECT value from json_each(${JSON.stringify(i)}))`
            .run();
        return null;
    }
}

@Mount('/reader/api/0', Reader)
@Controller()
export class GoogleReader {
    @Route('POST', '/accounts/ClientLogin')
    async login(@Body({ operations: 'Assert' }) { Email, Passwd }: Module.Login, jwt: JWT<{ Email: string; }>) {
        if (Email !== Bun.env.EMAIL || Passwd !== Bun.env.PASSWORD)
            throw new HTTPResponseError('Unauthorized', { status: 401 });
        const token = await jwt.sign({ Email });
        return `SID=${token}\nLSID=none\nAuth=${token}`;
    }
}
