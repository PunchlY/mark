import { routes } from 'router';
import { Main } from './index';
import { FormatRegistry } from '@sinclair/typebox';
import { sql } from './db';

FormatRegistry.Set('url', URL.canParse);

const server = Bun.serve({
    routes: routes(Main),
});

process.on("SIGINT", async () => {
    await server.stop();
    await sql.close();
    process.exit(0);
});
