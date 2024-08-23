import { version } from 'package.json';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        help: {
            short: 'h',
            type: 'boolean',
            default: false,
        },
        version: {
            short: 'v',
            type: 'boolean',
            default: false,
        },
        memory: {
            type: 'boolean',
            default: false,
        },
    },
});

if (values.help) {
    console.log(`
USAGE: ${process.argv0} [FLAGS/OPTIONS] [<path/module>...]
FLAGS:
  -h, --help       Prints help information
  -v, --version    Prints version information
      --memory     To open an in-memory database
OPTIONS:
ARGS:
  <path>...        e.g. ./my-script.ts
  <module>...      e.g. @foo/bar
`);
    process.exit(0);
}

if (values.version) {
    console.log(version);
    process.exit(0);
}

if (values.memory)
    Bun.env.DATABASE = ':memory:';

const { Entry } = await import('subscribe');
await Entry(positionals);

await import('./server/startup');
