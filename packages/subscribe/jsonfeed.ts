import { MD5 } from 'bun';
import { serialize } from 'bun:jsc';
import { XML } from './xml';
import { z } from 'zod';

const authorSchema = z.object({
    name: z.coerce.string(),
});

const itemSchema = z.object({
    id: z.string().min(1).or(z.number().transform(String)).nullish(),
    url: z.string().url().nullish(),
    title: z.string().nullish(),
    summary: z.string().nullish(),
    content_html: z.string().nullish(),
    date_published: z.coerce.date().nullish(),
    author: authorSchema.nullish(),
    authors: authorSchema.array().nullish(),
}).transform(({ id, title, url, content_html, summary, date_published, author, authors }) => {
    return {
        id: id ?? url ?? MD5.hash(serialize([title, url, content_html, summary, date_published]), 'hex'),
        title,
        url,
        content_html,
        summary,
        date_published,
        authors: authors || (author && [author]),
    };
});

const feedSchema = z.object({
    title: z.string().min(1),
    home_page_url: z.string().url().nullish(),
    description: z.string().nullish(),
    author: authorSchema.nullish(),
    authors: authorSchema.array().nullish(),
    items: itemSchema.array(),
}).transform(({ author, authors, ...data }) => {
    return { ...data, authors: authors || (author && [author]) };
});

async function JSONFeed(res?: Response | string | Record<string, any>, base?: string): Promise<JSONFeed> {
    if (res instanceof Response) {
        base = res.url;
        if (res.status !== 200)
            throw new Error(`${res.url} ${res.status}`);
        const type = res.headers.get('Content-Type');
        if (type?.startsWith('application/feed+json') || type?.startsWith('application/json'))
            res = await res.json() as any;
        else
            res = await res.text();
    }
    if (typeof res === 'string')
        res = XML(res.trimStart(), base);
    return feedSchema.parse(res);
}

interface JSONFeed extends z.infer<typeof feedSchema> { }
namespace JSONFeed {
    export interface $Input extends z.input<typeof feedSchema> { }

    export interface Author extends z.infer<typeof authorSchema> { }
    export namespace Author {
        export interface $Input extends z.input<typeof authorSchema> { }
    }

    export interface Item extends z.infer<typeof itemSchema> { }
    export namespace Item {
        export interface $Input extends z.input<typeof itemSchema> { }
    }
}

export default JSONFeed;
