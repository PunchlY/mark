import type { MiddlewareHandler, Env, Input, HonoRequest } from 'hono';
import type { z, ZodSchema } from 'zod';

function BodyValidator<T extends ZodSchema, E extends Env, P extends string, I extends Input = {
    in: { form?: z.input<T>; };
    out: { form: z.output<T>; };
},>(schema: T, opt?: Parameters<HonoRequest['parseBody']>[0]): MiddlewareHandler<E, P, I> {
    return async function (c, next) {
        const body = await c.req.parseBody(opt);
        const result = await schema.safeParseAsync(body);
        if (!result.success)
            return c.json(result, 400);
        c.req.addValidatedData('form', result.data);
        await next();
    };
}

function JSONValidator<T extends ZodSchema, E extends Env, P extends string, I extends Input = {
    in: { json?: z.input<T>; };
    out: { json: z.output<T>; };
},>(schema: T): MiddlewareHandler<E, P, I> {
    return async function (c, next) {
        const json = await c.req.json();
        const result = await schema.safeParseAsync(json);
        if (!result.success)
            return c.json(result, 400);
        c.req.addValidatedData('json', result.data);
        await next();
    };
}

export { BodyValidator, JSONValidator };
