import { Elysia, t } from 'elysia';
import { atom } from 'lib/view';
import basicAuth from './basic';
import { type Job } from 'subscribe';

const subscribe: Job = import.meta.require('mark:job').default;

export default new Elysia({ name: 'api', prefix: '/api' })
    .use(basicAuth)
    .get('/categories', () => subscribe.categories())
    .get('/feeds', () => subscribe.feeds())
    .post('/feeds', ({ body: { url, category } }) => subscribe.subscribe(url, category), {
        body: t.Object({
            url: t.String({ format: 'url' }),
            category: t.Optional(t.String()),
        }),
    })
    .group('/feeds/:id', { params: t.Object({ id: t.Numeric({ minimum: 1 }) }) }, (app) => app
        .get('', ({ params: { id }, error }) => subscribe.feed(id) || error(404))
        .delete('', ({ params: { id }, error }) => subscribe.unsubscribe(id) || error(404))
        .put('', async ({ params: { id }, error }) => await subscribe.refresh(id) || error(404))
        .post('', ({ params: { id }, body, error }) => subscribe.update(id, body) || error(404), {
            body: t.Object({
                category: t.Optional(t.String()),
                url: t.Optional(t.String({ format: 'url' })),
                refresh: t.Optional(t.Numeric({ minimum: 0 })),
                markRead: t.Optional(t.Numeric({ minimum: 0 })),
                clean: t.Optional(t.Numeric({ minimum: 0 })),
                plugins: t.Optional(t.Object({
                    fetch: t.Optional(t.Record(t.String(), t.String())),
                    rewrite: t.Optional(t.Record(t.String(), t.String())),
                })),
            }),
        })
        .get('/test', async ({ params: { id }, error }) => await subscribe.testSubscribe(id) || error(404))
    )
    .get('/options', () => subscribe.options)
    .post('/test', async ({ body: { url, ...options }, set }) => {
        const feed = await subscribe.test(url, options);
        set.headers['content-type'] = 'application/feed+json; charset=UTF-8';
        // set.headers['content-type'] = 'text/xml; charset=UTF-8';
        // return atom(feed);
        return feed;
    }, {
        body: t.Object({
            url: t.String({ format: 'url' }),
            fetch: t.Optional(t.Record(t.String(), t.String())),
            rewrite: t.Optional(t.Record(t.String(), t.String())),
        }),
    });
