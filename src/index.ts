import { plugin } from 'bun';
import { Entry } from 'subscribe/job';


if (process.argv.length > 2) {
    plugin({
        name: 'module',
        async setup(build) {
            build.module('mark:html', async () => {
                return {
                    exports: await import('lib/html'),
                    loader: 'object',
                };
            });
            build.module('mark:url', async () => {
                return {
                    exports: await import('lib/url'),
                    loader: 'object',
                };
            });
            build.module('mark:subscribe', async () => {
                return {
                    exports: await import('subscribe'),
                    loader: 'object',
                };
            });
            build.module('mark:plugin', async () => {
                return {
                    exports: await import('subscribe/plugin'),
                    loader: 'object',
                };
            });
        },
    });
    await Entry(process.argv.slice(2));
}

await import('./server/startup');

export { };
