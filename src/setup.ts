import { routes } from 'router';
import { Main } from './index';
import { FormatRegistry } from '@sinclair/typebox';

FormatRegistry.Set('url', URL.canParse);
FormatRegistry.Set('attribute-name', RegExp.prototype.test.bind(/^[^ \s/>=]+$/));

Bun.serve({
    routes: routes(Main),
});
