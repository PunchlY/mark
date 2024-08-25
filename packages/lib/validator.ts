import type { MiddlewareHandler, Env, Input, HonoRequest } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z, ZodSchema } from 'zod';

function BodyValidator<T extends ZodSchema, E extends Env, P extends string, I extends Input = {
    in: { form?: z.input<T>; };
    out: { form: z.output<T>; };
},>(schema: T, opt?: Parameters<HonoRequest['parseBody']>[0]): MiddlewareHandler<E, P, I> {
    return async function (c, next) {
        let body;
        try {
            body = await c.req.parseBody(opt);
        } catch (e) {
            throw new HTTPException(400, {
                message: `Malformed Body request. ${e instanceof Error ? e.message : e}`,
            });
        }
        const result = await schema.safeParseAsync(body);
        if (!result.success)
            return c.json(result, 400);
        c.req.addValidatedData('form', result.data);
        await next();
    };
}

export { BodyValidator };
