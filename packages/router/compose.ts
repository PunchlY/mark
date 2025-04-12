import type { BunRequest, Server, RouterTypes, HTMLBundle } from 'bun';
import { type Handler, getController } from './controller';
import { construct } from './service';
import { parseBody, newResponse, parseQuery } from './util';
import { Parse } from '@sinclair/typebox/value';
import { TypeGuard } from '@sinclair/typebox';

interface Context {
    request: BunRequest;
    server: Server;
    fulfilled: boolean;
    response?: Response;
    url?: URL;
    query?: Record<string, unknown>;
    body?: unknown;
    set: {
        readonly headers: Record<string, string>;
        status?: number;
        statusText?: string;
    };
    store?: Record<string, any>;
}

type HandlerMeta = ReturnType<typeof getMeta>;
function getMeta({ controller: { target }, propertyKey, paramtypes, init, type }: Handler) {
    return {
        instance: construct(target),
        propertyKey,
        paramtypes: paramtypes.map((type) => {
            if (typeof type === 'function')
                return { value: construct(type) };
            return type;
        }),
        ...init,
        isGenerator: type === 'GeneratorFunction' || type === 'AsyncGeneratorFunction',
    };
}

async function onHandle(ctx: Context, { instance, propertyKey, paramtypes, isGenerator, headers, status, statusText }: HandlerMeta) {
    const params: any[] = [];
    for (const type of paramtypes) {
        if ('value' in type) {
            params.push(type.value);
        } else {
            let value: any;
            switch (type.identifier) {
                case 'url': {
                    value = ctx.url ??= new URL(ctx.request.url);
                } break;
                case 'request': {
                    value = ctx.request;
                } break;
                case 'server': {
                    value = ctx.server;
                } break;
                case 'response': {
                    value = ctx.response;
                } break;
                case 'responseInit': {
                    value = ctx.set;
                } break;
                case 'store': {
                    value = ctx.store ??= {};
                } break;
                case 'params': {
                    value = ctx.request.params;
                } break;
                case 'query': {
                    value = ctx.query ??= parseQuery((ctx.url ??= new URL(ctx.request.url)).searchParams);
                } break;
                case 'cookie': {
                    value = ctx.request.cookies;
                }
                case 'body': {
                    if (typeof ctx.body === 'undefined') {
                        value = ctx.body = await parseBody(ctx.request);
                    } else {
                        value = ctx.body;
                    }
                } break;
                default:
                    throw new TypeError();
            }
            if (typeof type.key === 'string') {
                if (!Object.hasOwn(value, type.key))
                    throw new TypeError(`Missing key ${type.key}`);
                value = value[type.key];
            }
            if (TypeGuard.IsSchema(type.schema)) {
                value = type.operations ?
                    Parse(type.operations, type.schema, value) :
                    Parse(type.schema, value);
            }
            params.push(value);
        }
    }
    const res = await instance[propertyKey](...params);
    if (isGenerator) {
        const { value, done } = await (res as Generator | AsyncGenerator).next();
        for (const name in headers) {
            ctx.set.headers[name] = headers[name];
        }
        if (typeof status === 'number')
            ctx.set.status = status;
        if (typeof statusText === 'string')
            ctx.set.statusText = statusText;
        if (done) {
            ctx.response = newResponse(value, ctx.set);
        } else {
            ctx.response = new Response(async function* () { yield value, yield* (res as Generator | AsyncGenerator); } as any, ctx.set);
        }
        return ctx.fulfilled = true;
    } else if (typeof res !== 'undefined') {
        for (const name in headers) {
            ctx.set.headers[name] = headers[name];
        }
        if (typeof status === 'number')
            ctx.set.status = status;
        if (typeof statusText === 'string')
            ctx.set.statusText = statusText;
        ctx.response = newResponse(res, ctx.set);
        return ctx.fulfilled = true;
    }
}

function compileHandler(handler: Handler) {
    const beforeHandles = handler.controller.hooks.get('beforeHandle')?.map(getMeta);
    const afterHandle = handler.controller.hooks.get('afterHandle')?.map(getMeta);
    const handlerMeta = getMeta(handler);
    return async (request: BunRequest, server: Server) => {
        const ctx: Context = {
            request,
            server,
            fulfilled: false,
            response: undefined,
            url: undefined,
            query: undefined,
            body: undefined,
            set: {
                headers: {},
                status: undefined,
                statusText: undefined
            },
            store: undefined,
        };
        try {
            if (beforeHandles) for (const meta of beforeHandles) {
                if (await onHandle(ctx, meta))
                    return ctx.response!;
            }
            if (await onHandle(ctx, handlerMeta))
                return ctx.response!;
            ctx.set.status = 404;
            ctx.response = newResponse(null, ctx.set);
            ctx.fulfilled = true;
            return ctx.response;
        } finally {
            if (ctx.fulfilled && afterHandle) {
                ctx.set = { headers: {} }, ctx.fulfilled = false;
                for (const meta of afterHandle) {
                    if (await onHandle(ctx, meta))
                        ctx.set = { headers: {} };
                }
                if (ctx.fulfilled)
                    return ctx.response!;
            }
        }
    };
}

function routes(target: Function): Record<`/${string}`, (HTMLBundle & Response) | Response | RouterTypes.RouteHandler<string> | RouterTypes.RouteHandlerObject<string>> {
    const controller = getController(target);
    const log: { method: string, path: string, stack: string | undefined; }[] = [];
    const routes = Object.fromEntries(controller.handlers().map(([path, handlers]) => {
        if (handlers instanceof Map) {
            for (const [method, handler] of handlers)
                log.push({ method, path, stack: handler.stack });
            return [path, Object.fromEntries(handlers.entries().map(([method, handler]) => [method, compileHandler(handler)]))];
        } else {
            log.push({ method: '', path, stack: handlers.stack });
            if ('paramtypes' in handlers)
                return [path, compileHandler(handlers)];
            const { propertyKey, controller: { target }, init } = handlers;
            const value = construct(target)[propertyKey];
            if (Object.prototype.toString.call(value) === '[object HTMLBundle]')
                return [path, value];
            return [path, newResponse(construct(target)[propertyKey], init)];
        }
    }));
    console.table(log);
    return routes;
}

export { routes };
