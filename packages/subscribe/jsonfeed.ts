import { XML } from './xml';
import { Type, type StaticDecode, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const authorSchema = Type.Object({
    name: Type.String(),
});

const itemSchema = Type.Transform(Type.Object({
    id: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Transform(Type.Number()).Decode(String).Encode(Number), Type.Null()])),
    url: Type.Optional(Type.Union([Type.String({ format: 'url' }), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    content_html: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    date_published: Type.Optional(Type.Union([
        Type.Date(),
        Type.Transform(Type.Union([Type.String(), Type.Number()]))
            .Decode((value) => {
                const date = new Date(value);
                if (isNaN(date.valueOf()))
                    throw new RangeError('Invalid time value');
                return date;
            })
            .Encode((date) => date.toISOString()),
        Type.Null(),
    ])),
    author: Type.Optional(Type.Union([authorSchema, Type.Null()])),
    authors: Type.Optional(Type.Union([Type.Array(authorSchema), Type.Null()])),
}))
    .Decode(({ id, title, url, content_html, date_published, author, authors }) => {
        authors ||= (author && [author]);
        id ??= url ?? Bun.MD5.hash(JSON.stringify([title, url, content_html, date_published?.toISOString()]), 'base64');
        return { id, title, url, content_html, date_published, authors };
    })
    .Encode((value) => value);

const feedSchema = Type.Transform(Type.Object({
    title: Type.String({ minLength: 1 }),
    feed_url: Type.Optional(Type.Union([Type.String({ format: 'url' }), Type.Null()])),
    home_page_url: Type.Optional(Type.Union([Type.String({ format: 'url' }), Type.Null()])),
    author: Type.Optional(Type.Union([authorSchema, Type.Null()])),
    authors: Type.Optional(Type.Union([Type.Array(authorSchema), Type.Null()])),
    items: Type.Array(itemSchema),
}))
    .Decode(({ author, authors, items, ...data }) => {
        authors ||= (author && [author]);
        return {
            ...data,
            items: items.map((item) => {
                item.authors ||= authors;
                item.url &&= new URL(item.url, data.home_page_url ?? undefined).href;
                return item;
            }),
        };
    })
    .Encode((value) => value);

function JSONFeed(data: JSONFeed.$Input): Promise<JSONFeed>;
function JSONFeed(data: unknown): Promise<JSONFeed>;
async function JSONFeed(data: any): Promise<JSONFeed> {
    if (data instanceof Request)
        data = await Bun.fetch(data);
    if (data instanceof Response) {
        if (data.status !== 200)
            throw new Error(`${data.url} ${data.status}`);
        data = await data.text();
    }
    if (typeof data === 'string') {
        data = data.trimStart();
        if (data.startsWith('<'))
            data = XML(data.trimStart());
        else
            data = JSON.parse(data);
    }
    return Value.Decode(feedSchema, data);
}
type JSONFeed = StaticDecode<typeof feedSchema>;
namespace JSONFeed {
    export type $Input = Request | Response | string | Static<typeof feedSchema>;

    export function Item(item: Static<typeof itemSchema>): Item {
        return Value.Decode(itemSchema, item);
    }
    export type Item = StaticDecode<typeof itemSchema>;
    export namespace Item {
        export type $Input = Static<typeof itemSchema>;
    }
}

export default JSONFeed;
