import { Elysia } from 'elysia';

const app = new Elysia();

if (process.env.NODE_ENV !== 'production') {
    app.use(import('./logger'));
}

export default app
    .use(import('./api'))
    .use(import('./greader'))
    .use(import('./feedbin'));
