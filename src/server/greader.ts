// https://github.com/theoldreader/api
// https://github.com/FreshRSS/FreshRSS/blob/edge/p/api/greader.php

import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import db from 'db';
import { bodyValidator } from 'lib/validator';

const secret = `${Date()} ${Math.random()}`;

const app = new Hono<{
    Bindings: {
        EMAIL: string;
        PASSWORD: string;
    };
}>();

const loginSchema = z.object({
    Email: z.string().optional(),
    Passwd: z.string().optional(),
});

app.post('/accounts/ClientLogin', async (c) => {
    const { Email, Passwd } = loginSchema.parse({
        ...c.req.query(),
        ...await c.req.parseBody(),
        ...getCookie(c),
    });
    if (Email !== c.env.EMAIL || Passwd !== c.env.PASSWORD)
        return c.text('Unauthorized', 401);
    const token = await sign({
        Email,
        exp: (new Date().getTime() / 1000 | 0) + 60 * 60 * 3,
    }, secret);
    return c.text(`SID=${token}\nLSID=none\nAuth=${token}`);
});

const reader = app.basePath('/reader/api/0').use((async (c, next) => {
    const credentials = c.req.header('Authorization');
    if (credentials && credentials.startsWith('GoogleLogin auth=')) try {
        const token = credentials.substring(17);
        const { Email } = await verify(token, secret);
        if (Email === c.env.EMAIL) {
            c.set('token', token);
            return await next();
        }
    } catch { }
    throw new HTTPException(401);
}) as MiddlewareHandler<{
    Bindings: {
        EMAIL: string;
    };
    Variables: {
        token: string;
    };
}>);

reader.get('/user-info', async (c) => {
    return c.json({
        userId: '1',
        userName: c.env.EMAIL,
        userProfileId: '1',
        userEmail: c.env.EMAIL,
    });
});

reader.get('/token', async (c) => {
    return c.text(c.var.token);
});

const tagsStmt = db.query<{ label: string; }, []>('SELECT name label FROM Category');
reader.get('/tag/list', async (c) => {
    const tags = tagsStmt.all();
    return c.json({
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
    });
});

const subscriptionsStmt = db.query<{
    id: number;
    title: string;
    url: string;
    htmlUrl: string;
    label: string;
}, []>('SELECT Feed.id, title, url, homePage htmlUrl, name label FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE title IS NOT NULL');
reader.get('/subscription/list', async (c) => {
    const subscriptions = subscriptionsStmt.all();
    return c.json({
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
    });
});

class Item {
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
        const categories = [
            'user/-/state/com.google/reading-list',
            `user/-/label/${this.category}`,
        ];
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
            alternate: [{
                href: this.url,
            }],
            summary: {
                content: this.contentHtml,
            },
            content: {
                content: this.contentHtml,
            },
            origin: {
                streamId: `feed/${this.feedId.toString(16).padStart(16, '0')}`,
                title: this.feedTitle,
                htmlUrl: this.homePage,
            },
            canonical: [{ href: this.url }],
        };
    }
}

const streamSchema = z.object({
    n: z.coerce.number().nonnegative().default(10),
    s: z.string().transform((s) => {
        if (s === 'user/-/state/com.google/reading-list')
            return;
        if (s === 'user/-/state/com.google/read')
            return { read: true };
        if (s === 'user/-/state/com.google/starred')
            return { star: true };
        if (s.startsWith('user/-/label/'))
            return { category: s.substring(13) };
        if (s.startsWith('feed/')) {
            const id = parseInt(s.substring(5), 16);
            if (id > 0)
                return { feedId: id };
        }
        throw new Error(`unknown stream type: ${s}`);
    }).optional().transform((s) => {
        return {
            read: s?.read ?? null,
            star: s?.star ?? null,
            category: s?.category ?? null,
            feedId: s?.feedId ?? null,
        };
    }),
    xt: z.enum(['user/-/state/com.google/read']).transform(() => {
        return { read: false };
    }).optional(),
    r: z.string().optional(),
    c: z.coerce.number().nonnegative().optional(),
    nt: z.coerce.number().nonnegative().optional(),
    ot: z.coerce.number().nonnegative().optional(),
}).transform(({ n, s, xt, nt, ot, r, c }) => {
    return {
        n,
        ...s,
        ...xt,
        nt: nt ?? null,
        ot: ot ?? null,
        r: r === 'o',
        c: c ?? null,
    };
});

const streamSuery = <T>(column: string) => {
    return db.query<T, z.infer<typeof streamSchema>>(`SELECT ${column} FROM (SELECT Item.id, Item.url, Item.title, Item.authors, Item.contentHtml, ifnull(Item.datePublished, Item.createdAt) publishedAt, Item.createdAt, Item.read, Item.star, Feed.id feedId, Feed.title feedTitle, Feed.url feedUrl, Feed.homePage, Category.id categoryId, Category.name category FROM Item LEFT JOIN Feed ON Item.feedId = Feed.id LEFT JOIN Category ON Feed.categoryId = Category.id WHERE Feed.title IS NOT NULL AND ifnull(read=$read,1) AND ifnull(star=$star,1) AND ifnull(category=$category,1) AND ifnull(feedId=$feedId,1) AND ifnull(publishedAt<=$nt,1) AND ifnull(publishedAt>=$ot,1) AND ifnull(iif($r,Item.id>=$c,Item.id<=$c),1) ORDER BY iif($r,Item.id,null) ASC, iif($r,null,Item.id) DESC LIMIT $n+1)`);
};

const idsStmt = streamSuery<{ id: number; }>('id');
reader.get('/stream/items/ids', zValidator('query', streamSchema), async (c) => {
    const param = c.req.valid('query'), { n } = param;
    const itemRefs = idsStmt.all(param);
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
    return c.json(data);
});

const contentsStmt = streamSuery('id, url, title, (SELECT group_concat(json_extract(value,"$.name"),", ") from json_each(authors)) author, contentHtml, publishedAt, createdAt, read, star, feedId, feedTitle, homePage, category').as(Item);
reader.get('/stream/contents', zValidator('query', streamSchema), async (c) => {
    const param = c.req.valid('query'), { n } = param;
    const items = contentsStmt.all(param);
    return c.json({
        id: 'user/-/state/com.google/reading-list',
        updated: new Date().getTime() / 1000 | 0,
        items,
        continuation: items.length > n ? items.pop()!.id : undefined,
    });
});

const idSchema = z.string().startsWith('tag:google.com,2005:reader/item/').transform((s) => parseInt(s.substring(32), 16)).pipe(z.number()).or(z.coerce.number());
const idsSchema = idSchema.array().or(idSchema);

const itemsContentsStmt = db.query<unknown, [idsJSON: string]>(`SELECT Item.id, Item.url, Item.title, (SELECT group_concat(json_extract(value,"$.name"),", ") from json_each(authors)) author, Item.contentHtml, ifnull(Item.datePublished, Item.createdAt) publishedAt, Item.createdAt, Item.read, Item.star, Feed.id feedId, Feed.title feedTitle, Feed.url feedUrl, Feed.homePage, Category.id categoryId, Category.name category FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id LEFT JOIN Category ON Feed.categoryId=Category.id WHERE Feed.title IS NOT NULL AND Item.id IN (SELECT value from json_each(?))`).as(Item);
reader.post('/stream/items/contents', bodyValidator(z.object({ i: idsSchema, }), { all: true }), async (c) => {
    const { i } = c.req.valid('form');
    const items = itemsContentsStmt.all(`[${i}]`);
    return c.json({
        id: 'user/-/state/com.google/reading-list',
        updated: new Date().getTime() / 1000 | 0,
        items,
    });
});

const editTagStmt = db.query<null, [read: boolean | null, star: boolean | null, idsJSON: string]>(`UPDATE Item SET read=ifnull(?,read),star=ifnull(?,star) WHERE id IN (SELECT value from json_each(?))`);
reader.post('/edit-tag', bodyValidator(z.object({
    i: idsSchema,
    a: z.string().transform((a) => {
        if (a === 'user/-/state/com.google/read')
            return { read: true };
        if (a === 'user/-/state/com.google/starred')
            return { star: true };
    }).optional(),
    r: z.string().transform((r) => {
        if (r === 'user/-/state/com.google/read')
            return { read: false };
        if (r === 'user/-/state/com.google/starred')
            return { star: false };
    }).optional(),
}).transform(({ i, a, r }) => {
    return { i, read: a?.read ?? r?.read ?? null, star: a?.star ?? r?.star ?? null };
}), { all: true }), async (c) => {
    const { i, read, star } = c.req.valid('form');
    editTagStmt.run(read, star, `[${i}]`);
    return c.body(null, 204);
});

export default app;
