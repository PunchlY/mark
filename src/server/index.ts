import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { showRoutes } from 'hono/dev';
import feedbinRouter from './feedbin';
import greaderRouter from './greader';
import apiRouter from './api';
import { staticRouteHandler } from './static';

const app = new Hono({ strict: false });

if (process.env.NODE_ENV !== 'production') {
    app.use(logger());
    app.get(staticRouteHandler());
}

app
    .route('/feedbin', feedbinRouter)
    .route('/greader', greaderRouter)
    .route('/api', apiRouter);

if (process.env.NODE_ENV !== 'production')
    showRoutes(app);

export default app;
