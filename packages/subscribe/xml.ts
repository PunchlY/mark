import { parseXml } from '@rgrove/parse-xml';
import type { XmlElement } from '@rgrove/parse-xml';
import { getElements, getText } from 'lib/xml';

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
    for (const root of getElements(parseXml(xml))) {
        switch (root.name) {
            case 'feed':
                return ATOM(root);
            case 'rss':
                for (const channel of getElements(root)) {
                    if (channel.name !== 'channel')
                        continue;
                    return RSS2(channel);
                }
                break;
        }
    }
}

export { XML };
