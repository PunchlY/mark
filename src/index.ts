import './format';
import { Job } from 'subscribe';

const entrypoint = process.argv[2];
const job = await Job.entry(entrypoint);

Bun.plugin({
    name: 'mark:job',
    setup(build) {
        build.module('mark:job', () => ({
            exports: { default: job },
            loader: 'object',
        }));
    },
});

(await import('./server')).default.listen({
    // port: Bun.env.PORT,
    hostname: Bun.env.HOSTNAME,
});

job.timer.start();
