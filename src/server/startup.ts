import { serve } from 'bun';
import app from './index';

Object.assign(serve({
    port: Bun.env.PORT,
    hostname: Bun.env.HOSTNAME,
    fetch: app.fetch,
}), {
    EMAIL: Bun.env.EMAIL ?? 'admin',
    PASSWORD: Bun.env.PASSWORD ?? 'adminadmin',
});
