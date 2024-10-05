#!/bin/sh
NODE_ENV=production bun build ./src/index.ts --target bun --minify --outfile ./dist/index.js
