import { Entry } from 'subscribe/job';

if (process.argv.length > 2)
    await Entry(process.argv.slice(2));

await import('./server/startup');

export { };
