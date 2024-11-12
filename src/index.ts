import { plugin, serve, type Server } from 'bun';
import { Job } from 'subscribe/job';
import app from './server';
import staticRouter from './server/static';

plugin({
    name: 'module',
    setup(build) {
        build.module('mark:subscribe', async () => {
            return {
                exports: await import('subscribe'),
                loader: 'object',
            };
        });
    },
});

const env = {
    EMAIL: Bun.env.EMAIL ?? 'admin',
    PASSWORD: Bun.env.PASSWORD ?? 'adminadmin',
    SUBSCRIBE: await Job.entry(process.argv[2]),
};
const server = serve({
    development: process.env.NODE_ENV !== 'production',
    // port: Bun.env.PORT,
    hostname: Bun.env.HOSTNAME,
    static: staticRouter,
    fetch: app.fetch,
});

Object.assign(server, env);

type Env = typeof env & Server;

declare global {
    interface Bindings extends Env { }
}
