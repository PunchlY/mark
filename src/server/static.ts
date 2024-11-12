import { $, file, main } from 'bun';
import { resolve, relative } from 'path';
import { staticRouteData } from './static' with { type: 'macro' };
import { type MiddlewareHandler } from 'hono';

const staticRouter: Record<`/${string}`, Response> = {};
if (main && process.env.NODE_ENV === 'production') {
    for (const [type, route] of Object.entries(staticRouteData('static') as unknown as Awaited<ReturnType<typeof staticRouteData>>))
        for (const [path, text] of Object.entries(route) as [`/${string}`, string][])
            staticRouter[path] = new Response(text, { headers: { 'Content-Type': type } });
}

function staticRouteHandler(): MiddlewareHandler {
    const base = resolve('static');
    return async function (c, next) {
        for (const file of getFiles(`${base}${c.req.path}`))
            if (await file.exists())
                return new Response(file);
        await next();
    };
    function* getFiles(path: string) {
        yield file(path);
        if (path.endsWith('/'))
            yield file(`${path}index.html`);
    }
}

async function _staticRouteData(base: string) {
    if (!main)
        return {};
    base = resolve(base);
    const data: Record<string, Record<`/${string}`, string>> = {};
    for await (const { path, text, type } of readdir(resolve(base)))
        (data[type] ??= {})[path] = text;
    return data;

    async function* readdir(path: string) {
        for await (const filename of $`bash -c ${`function readdir(){ for file in \`ls $1\`;do if [ -d $1"/"$file ];then readdir $1"/"$file;else echo $1"/"$file;fi;done };readdir ${$.escape(path)}`}`.lines()) {
            if (!filename)
                continue;
            console.log(filename);
            yield {
                path: `/${relative(base, filename.replace(/\/index.html$/, ''))}` as const,
                text: await $`cat ${filename}`.text(),
                type: file(filename).type,
            };
        }
    }
}

export default staticRouter;
export { staticRouteHandler };
export { _staticRouteData as staticRouteData };
