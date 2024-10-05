import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { showRoutes } from 'hono/dev';
import feedbinApp from './feedbin';
import greaderApp from './greader';
import apiApp from './api';

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

app.route('/api', apiApp);

if (process.env.NODE_ENV !== 'production')
    showRoutes(app);

export default app;
