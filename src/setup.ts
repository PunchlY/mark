import { routes } from 'router';
import { HTTPResponseError } from './error';
import { Main } from './index';
import { FormatRegistry } from '@sinclair/typebox';

FormatRegistry.Set('url', URL.canParse);
FormatRegistry.Set('attribute-name', RegExp.prototype.test.bind(/^[^ \n\r\t\f/>=]+$/));

export default {
    routes: routes(Main),
    fetch() {
        return new Response(null, { status: 404 });
    },
    error(err: Bun.ErrorLike) {
        if (err instanceof HTTPResponseError)
            return err.getResponse();
        if (process.env.NODE_ENV !== 'production')
            throw err;
        return new Response(null, { status: 500 });
    },
};
