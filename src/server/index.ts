import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { logger } from 'hono/logger';
import { showRoutes } from 'hono/dev';
import feedbinApp from './feedbin';
import greaderApp from './greader';
import { Atom } from 'lib/view';
import { Feed } from 'subscribe';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const app = new Hono<{
    Bindings: {
        EMAIL: string;
        PASSWORD: string;
    };
}>({ strict: false });

if (process.env.NODE_ENV !== 'production')
    app.use(logger());

app.get('/', (c) => c.text('hello.'));

app.route('/feedbin', feedbinApp);
app.route('/greader', greaderApp);

app.get('/test', basicAuth({
    verifyUser(username, password, c) {
        return username === c.env.EMAIL && password === c.env.PASSWORD;
    },
}), zValidator('query', z.object({
    url: z.string().url(),
})), async (c) => {
    const { url } = c.req.valid('query');
    const feed = await Feed.test(url);
    return c.html(Atom(feed), 200, { 'Content-Type': 'text/xml; charset=UTF-8' });
});

if (process.env.NODE_ENV !== 'production')
    showRoutes(app);

export default app;
