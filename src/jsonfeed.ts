import { parseXml } from '@rgrove/parse-xml';
import type { XmlElement } from '@rgrove/parse-xml';
import { getElements, getText } from 'lib/xml';
import { Type, type StaticDecode, type Static } from '@sinclair/typebox';
import { Assert, Convert, Decode, Default } from '@sinclair/typebox/value';

const authorSchema = Type.Object({
    name: Type.String(),
});

const itemSchema = Type.Transform(Type.Object({
    id: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Transform(Type.Number()).Decode(String).Encode(Number), Type.Null()])),
    url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    content_html: Type.Optional(Type.Union([
        Type.String(),
        Type.Null(),
    ])),
    date_published: Type.Optional(Type.Union([
        Type.Date(),
        Type.Transform(Type.Union([Type.String(), Type.Integer()]))
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
    home_page_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    author: Type.Optional(Type.Union([authorSchema, Type.Null()])),
    authors: Type.Optional(Type.Union([Type.Array(authorSchema), Type.Null()])),
    items: Type.Array(itemSchema),
}))
    .Decode(({ author, authors, home_page_url, items, ...data }) => {
        authors ||= (author && [author]);
        home_page_url &&= new URL(home_page_url, data.feed_url ?? undefined).href;
        return {
            ...data,
            home_page_url,
            items: items.map((item) => {
                item.authors ||= authors;
                item.url &&= new URL(item.url, home_page_url ?? data.feed_url ?? undefined).href;
                return item;
            }),
        };
    })
    .Encode((value) => value);

function ATOM(node: XmlElement) {
    const feed: {
        title: string;
        authors?: { name: string; }[];
        home_page_url?: string;
        items: {
            id?: string;
            url?: string;
            title?: string;
            content_html?: string;
            date_published?: string;
            authors?: { name: string; }[];
        }[];
    } = { title: '', items: [] };
    for (const element of getElements(node)) {
        switch (element.name) {
            case 'title':
                feed.title = getText(element);
                break;
            case 'author':
                for (const name of getElements(element)) {
                    if (name.name !== 'name')
                        continue;
                    feed.authors ??= [];
                    feed.authors.push({ name: getText(name) });
                    break;
                }
                break;
            case 'link':
                const { rel, href } = element.attributes;
                if (rel === undefined || rel === 'alternate')
                    feed.home_page_url = href;
                break;
            case 'entry':
                const item: typeof feed.items[number] = {};
                feed.items.push(item);
                for (const itemElement of getElements(element)) {
                    switch (itemElement.name) {
                        case 'id':
                            item.id = getText(itemElement);
                            break;
                        case 'title':
                            item.title = getText(itemElement);
                            break;
                        case 'summary':
                            item.content_html ||= getText(itemElement);
                            break;
                        case 'content':
                            item.content_html = getText(itemElement);
                            break;
                        case 'published':
                            item.date_published = getText(itemElement);
                            break;
                        case 'author':
                            for (const name of getElements(itemElement)) {
                                if (name.name !== 'name')
                                    continue;
                                item.authors ??= [];
                                item.authors.push({ name: getText(name) });
                                break;
                            }
                            break;
                        case 'link':
                            const { rel, href } = itemElement.attributes;
                            if (rel === undefined || rel === 'alternate')
                                item.url = href;
                            break;
                    }
                }
                break;
        }
    }
    return feed;
}

function RSS2(node: XmlElement) {
    const feed: {
        title: string;
        home_page_url?: string;
        items: {
            id?: string;
            url?: string;
            title?: string;
            content_html?: string;
            date_published?: string;
            author?: { name: string; };
        }[];
    } = { title: '', items: [] };
    feed.items = [];
    for (const element of getElements(node)) {
        switch (element.name) {
            case 'title':
                feed.title = getText(element);
                break;
            case 'link':
                feed.home_page_url = getText(element);
                break;
            case 'item':
                const item: typeof feed.items[number] = {};
                feed.items.push(item);
                for (const itemElement of getElements(element)) {
                    switch (itemElement.name) {
                        case 'guid':
                            item.id = getText(itemElement);
                            break;
                        case 'title':
                            item.title = getText(itemElement);
                            break;
                        case 'description':
                            item.content_html ||= getText(itemElement);
                            break;
                        case 'content:encoded':
                            item.content_html = getText(itemElement);
                            break;
                        case 'pubDate':
                            item.date_published = getText(itemElement);
                            break;
                        case 'author':
                            item.author = { name: getText(itemElement) };
                            break;
                        case 'link':
                            item.url = getText(itemElement);
                            break;
                    }
                }
                break;
        }
    }
    return feed;
}

function XML(xml: string) {
    const { root } = parseXml(xml);
    if (!root)
        throw new Error('Invalid XML');
    switch (root.name) {
        case 'feed':
            return ATOM(root);
        case 'rss': for (const channel of getElements(root)) {
            if (channel.name !== 'channel')
                continue;
            return RSS2(channel);
        }
    }
    throw new Error('Invalid XML');
}

function JSONFeed(data: JSONFeed.$Input, feedUrl?: string | URL): Promise<JSONFeed>;
function JSONFeed(data: unknown, feedUrl?: string | URL): Promise<JSONFeed>;
async function JSONFeed(data: any, feedUrl?: string | URL): Promise<JSONFeed> {
    if (data instanceof Response) {
        if (data.status !== 200)
            throw new Error(`${data.url} ${data.status}`);
        data = await data.text();
    }
    if (typeof data === 'string') {
        data = data.trimStart();
        if (data.startsWith('<'))
            data = XML(data);
        else
            data = JSON.parse(data);
    }
    data = Convert(feedSchema, Default(feedSchema, data));
    Assert(feedSchema, data);
    if (feedUrl)
        data.feed_url ??= typeof feedUrl === 'string' ? feedUrl : feedUrl.href;
    return Decode(feedSchema, data);
}
type JSONFeed = StaticDecode<typeof feedSchema>;
namespace JSONFeed {
    export type $Input = Response | string | Static<typeof feedSchema>;

    export type Item = StaticDecode<typeof itemSchema>;
}

export { JSONFeed };
