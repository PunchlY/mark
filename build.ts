#!/bin/env -S NODE_ENV=production bun

import { $, build } from 'bun';

const { logs, success } = await build({
    entrypoints: ['./src/cli.ts'],
    outdir: './dist',
    target: 'bun',
    minify: {
        syntax: true,
    },
    define: {
    },
    plugins: [],
});

for (const message of logs)
    console.log(message);

if (!success)
    process.exit(1);

// await $`bun build ./dist/cli.js --compile --outfile ./dist/cli --minify`;
