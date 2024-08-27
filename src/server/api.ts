import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Feed } from 'subscribe/subscribe';
import { Atom } from 'lib/view';

const app = new Hono<{
    Bindings: {
        EMAIL: string;
        PASSWORD: string;
    };
}>().use(basicAuth({
    verifyUser(username, password, c) {
        return username === c.env.EMAIL && password === c.env.PASSWORD;
    },
}));

app.get('/test', zValidator('query', z.object({
    url: z.string().url(),
    category: z.string().optional(),
})), async (c) => {
    const { url, category } = c.req.valid('query');
    const feed = await Feed.test(url, category);
    return c.html(Atom(feed), 200, { 'Content-Type': 'text/xml; charset=UTF-8' });
});

export default app;
