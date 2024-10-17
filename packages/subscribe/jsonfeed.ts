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
    content_html: z.string().nullish(),
    date_published: z.coerce.date().nullish() as unknown as z.ZodOptional<z.ZodNullable<z.ZodEffects<z.ZodNumber, Date, string | number | Date>>>,
    author: authorSchema.nullish(),
    authors: authorSchema.array().nullish(),
}).transform(({ id, title, url, content_html, date_published, author, authors }) => {
    authors ||= (author && [author]);
    return {
        id: id ?? url ?? MD5.hash(serialize([title ?? undefined, url ?? undefined, content_html ?? undefined, date_published?.toISOString()]), 'hex'),
        title,
        url,
        content_html,
        date_published,
        authors,
    };
});

const feedSchema = z.object({
    title: z.string().min(1),
    home_page_url: z.string().url().nullish(),
    author: authorSchema.nullish(),
    authors: authorSchema.array().nullish(),
    items: itemSchema.array(),
}).transform(({ author, authors, items, ...data }) => {
    authors ||= (author && [author]);
    return {
        ...data,
        items: items.map((item) => {
            item.authors ||= authors;
            // item.url &&= new URL(item.url, data.home_page_url ?? undefined).href;
            return item;
        }),
    };
});

async function JSONFeed(data?: JSONFeed.$Input, base?: string): Promise<JSONFeed> {
    if (data instanceof Request)
        data = await fetch(data);
    if (data instanceof Response) {
        base = data.url || base;
        if (data.status !== 200)
            throw new Error(`${data.url} ${data.status}`);
        data = await data.text();
    }
    if (typeof data === 'string') {
        data = data.trimStart();
        if (data.startsWith('<'))
            data = XML(data.trimStart(), base);
        else
            data = JSON.parse(data);
    }
    return feedSchema.parse(data);
}
interface JSONFeed extends z.infer<typeof feedSchema> { }
namespace JSONFeed {
    export type $Input = Request | Response | string | z.input<typeof feedSchema>;

    export function Item(item: z.input<typeof itemSchema>): Item {
        return itemSchema.parse(item);
    }
    export interface Item extends z.infer<typeof itemSchema> { }
    export namespace Item {
        export type $Input = z.input<typeof itemSchema>;
    }
}

export default JSONFeed;
