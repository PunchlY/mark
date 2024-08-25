import { parseXml } from '@rgrove/parse-xml';
import type { XmlElement } from '@rgrove/parse-xml';
import { GetElements, GetText } from 'lib/xml';

function ATOM(node: XmlElement, base?: string) {
    const feed: {
        title: string;
        authors?: { name: string; }[];
        home_page_url?: string;
        description?: string;
        items: {
            id?: string;
            url?: string;
            title?: string;
            content_html?: string;
            date_published?: Date;
            authors?: { name: string; }[];
        }[];
    } = { title: '', items: [] };
    for (const element of GetElements(node)) {
        switch (element.name) {
            case 'title':
                feed.title = GetText(element);
                break;
            case 'author':
                for (const name of GetElements(element)) {
                    if (name.name !== 'name')
                        continue;
                    feed.authors ??= [];
                    feed.authors.push({ name: GetText(name) });
                    break;
                }
                break;
            case 'link':
                const { rel, href } = element.attributes;
                if (rel === undefined || rel === 'alternate')
                    feed.home_page_url = new URL(href, base).href;
                break;
            case 'subtitle':
                feed.description = GetText(element);
                break;
            case 'entry':
                const item: typeof feed.items[number] = {};
                feed.items.push(item);
                for (const itemElement of GetElements(element)) {
                    switch (itemElement.name) {
                        case 'id':
                            item.id = GetText(itemElement);
                            break;
                        case 'title':
                            item.title = GetText(itemElement);
                            break;
                        case 'summary':
                            item.content_html ||= GetText(itemElement);
                            break;
                        case 'content':
                            item.content_html = GetText(itemElement);
                            break;
                        case 'published':
                            item.date_published = new Date(GetText(itemElement));
                            break;
                        case 'author':
                            for (const name of GetElements(itemElement)) {
                                if (name.name !== 'name')
                                    continue;
                                item.authors ??= [];
                                item.authors.push({ name: GetText(name) });
                                break;
                            }
                            break;
                        case 'link':
                            const { rel, href } = itemElement.attributes;
                            if (rel === undefined || rel === 'alternate')
                                item.url = new URL(href, base).href;
                            break;
                    }
                }
                break;
        }
    }
    return feed;
}

function RSS2(node: XmlElement, base?: string) {
    const feed: {
        title: string;
        home_page_url?: string;
        description?: string;
        items: {
            id?: string;
            url?: string;
            title?: string;
            content_html?: string;
            date_published?: Date;
            author?: { name: string; };
        }[];
    } = { title: '', items: [] };
    feed.items = [];
    for (const element of GetElements(node)) {
        switch (element.name) {
            case 'title':
                feed.title = GetText(element);
                break;
            case 'link':
                feed.home_page_url = new URL(GetText(element), base).href;
                break;
            case 'description':
                feed.description = GetText(element);
                break;
            case 'item':
                const item: typeof feed.items[number] = {};
                feed.items.push(item);
                for (const itemElement of GetElements(element)) {
                    switch (itemElement.name) {
                        case 'guid':
                            item.id = GetText(itemElement);
                            break;
                        case 'title':
                            item.title = GetText(itemElement);
                            break;
                        case 'description':
                            item.content_html ||= GetText(itemElement);
                            break;
                        case 'content:encoded':
                            item.content_html = GetText(itemElement);
                            break;
                        case 'pubDate':
                            item.date_published = new Date(GetText(itemElement));
                            break;
                        case 'author':
                            item.author = { name: GetText(itemElement) };
                            break;
                        case 'link':
                            item.url = new URL(GetText(itemElement), base).href;
                            break;
                    }
                }
                break;
        }
    }
    return feed;
}

function XML(xml: string, base?: string) {
    for (const root of GetElements(parseXml(xml))) {
        switch (root.name) {
            case 'feed':
                return ATOM(root, base);
            case 'rss':
                for (const channel of GetElements(root)) {
                    if (channel.name !== 'channel')
                        continue;
                    return RSS2(channel, base);
                }
                break;
        }
    }
}

export { XML };
