// https://github.com/theoldreader/api
// https://github.com/FreshRSS/FreshRSS/blob/edge/p/api/greader.php

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import db from 'db';
import { BodyValidator } from 'lib/validator';

const secret = `${Date()} ${Math.random()}`;

const app = new Hono<{
    Bindings: {
        EMAIL: string;
        PASSWORD: string;
    };
    Variables: {
        token: string;
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

const verifySchema = z.object({
    Email: z.string(),
});

const reader = app.basePath('/reader/api/0').use(async (c, next) => {
    const credentials = c.req.header('Authorization');
    if (credentials && credentials.startsWith('GoogleLogin auth='))
        c.set('token', credentials.substring(17));
    await next();
}, async (c, next) => {
    const { token } = c.var;
    try {
        const { Email } = verifySchema.parse(await verify(token, secret));
        if (Email === c.env.EMAIL)
            return await next();
    } catch {
        throw new HTTPException(401);
    }
    throw new HTTPException(401);
});

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

const tagsQuery = db.query<{ label: string; }, []>('SELECT name label FROM CategoryView');
reader.get('/tag/list', async (c) => {
    const tags = tagsQuery.all();
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

const subscriptionsQuery = db.query<{
    id: number;
    title: string;
    url: string;
    htmlUrl: string;
    label: string;
}, []>('SELECT id, title, url, homePage htmlUrl, category label FROM FeedView');
reader.get('/subscription/list', async (c) => {
    const subscriptions = subscriptionsQuery.all();
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
    declare private authors: string | null;
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
        if (this.authors)
            return (JSON.parse(this.authors) as { name: string; }[])
                .map(({ name }) => name).join(', ');
        return null;
    }

    toJSON() {
        const {
            id,
            title,
            url,
            author,
            contentHtml,
            publishedAt,
            createdAt,
            read,
            star,
            feedId,
            feedTitle,
            homePage,
            category,
        } = this;
        const categories = [
            'user/-/state/com.google/reading-list',
            `user/-/label/${category}`,
        ];
        if (star)
            categories.push('user/-/state/com.google/starred');
        if (read)
            categories.push('user/-/state/com.google/read');
        return {
            id: `tag:google.com,2005:reader/item/${id.toString(16).padStart(16, '0')}`,
            categories,
            title,
            crawlTimeMsec: `${createdAt}000`,
            timestampUsec: `${publishedAt}000000`,
            published: publishedAt,
            author,
            alternate: [{
                href: url,
            }],
            summary: {
                content: contentHtml,
            },
            content: {
                content: contentHtml,
            },
            origin: {
                streamId: `feed/${feedId.toString(16).padStart(16, '0')}`,
                title: feedTitle,
                htmlUrl: homePage,
            },
            canonical: [{ href: url }],
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

const streamSuery = (secret: string) => {
    return db.query<any, z.infer<typeof streamSchema>>(`SELECT ${secret} FROM ItemView WHERE ifnull(read=$read,1) AND ifnull(star=$star,1) AND ifnull(category=$category,1) AND ifnull(feedId=$feedId,1) AND ifnull(publishedAt<=$nt,1) AND ifnull(publishedAt>=$ot,1) AND ifnull(iif($r,id>=$c,id<=$c),1) ORDER BY iif($r,id,null) ASC, iif($r,null,id) DESC LIMIT $n+1`);
};

const contentsQuery = streamSuery('id, url, title, authors, contentHtml, publishedAt, createdAt, read, star, feedId, feedTitle, homePage, category').as(Item);

const idsQuery = streamSuery('id');

reader.get('/stream/items/ids', zValidator('query', streamSchema), async (c) => {
    const param = c.req.valid('query'), { n } = param;
    const itemRefs = idsQuery.all(param);
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

reader.get('/stream/contents', zValidator('query', streamSchema), async (c) => {
    const param = c.req.valid('query'), { n } = param;
    const items = contentsQuery.all(param);
    return c.json({
        id: 'user/-/state/com.google/reading-list',
        updated: new Date().getTime() / 1000 | 0,
        items,
        continuation: items.length > n ? items.pop()!.id : undefined,
    });
});

const idSchema = z.string().startsWith('tag:google.com,2005:reader/item/').transform((s) => parseInt(s.substring(32), 16)).pipe(z.number()).or(z.coerce.number());
const idsSchema = idSchema.array().or(idSchema);

reader.post('/stream/items/contents', BodyValidator(z.object({
    i: idsSchema,
}), { all: true }), async (c) => {
    const { i } = c.req.valid('form');
    const items = db.prepare<any, number[]>(`SELECT id, title, url, authors, contentHtml, publishedAt, createdAt, read, star, feedId, feedTitle, homePage, category FROM ItemView WHERE id IN (${i})`).as(Item).all();
    return c.json({
        id: 'user/-/state/com.google/reading-list',
        updated: new Date().getTime() / 1000 | 0,
        items,
    });
});

reader.post('/edit-tag', BodyValidator(z.object({
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
    db.run(`UPDATE ItemView SET read=?,star=? WHERE id IN (${i})`, [read, star]);
    return c.body(null, 204);
});

export default app;
