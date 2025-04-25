import { test, expect, afterAll } from 'bun:test';
import { JSONFeed } from './jsonfeed';
import APP from './setup';
import type { API, Module } from './api';

namespace api {

    const server = Bun.serve({ ...APP, port: 0 });

    server.unref();

    afterAll(async () => {
        await server.stop();
    });

    type ToJSON<T> = T extends { toJSON(): infer J; } ? ToJSON<J> : { [K in keyof T]: ToJSON<T[K]> };
    type _Response<T> = { [K in keyof T]: T[K] extends (...args: any[]) => Promise<infer R> | infer R ? ToJSON<R> : never };
    export type Response = _Response<API>;

    export async function fetch<T>(url: string | URL, options?: Omit<RequestInit, 'body'> & {
        query?: Record<string, string | number>;
        body?: unknown;
    }) {
        const headers = new Headers(options?.headers);
        headers.set('Content-Type', 'application/json');
        headers.set('Accept', 'application/json');
        url = new URL(url, server.url);
        for (const key in options?.query)
            url.searchParams.set(key, String(options.query[key]));
        const body = typeof options?.body === 'undefined' ? undefined : JSON.stringify(options.body);
        const res = await Bun.fetch(url, { ...options, headers, body });
        if (!res.ok)
            throw new Error(JSON.stringify({
                status: res.status,
                statusText: res.statusText,
            }, null, 2));
        return await res.json() as T;
    }

    export function temp<R extends { [K in keyof R]: Bun.RouterTypes.RouteValue<K & string> }>(routes: R) {
        const server = Bun.serve({ routes, port: 0 });
        return {
            ...Object.fromEntries(Object.keys(routes).map((path) => [path, new URL(path, server.url).href])) as { readonly [K in keyof R]: string },
            async [Symbol.dispose]() {
                await server.stop();
            },
        };
    }
}

test('plugins.jq', async () => {
    using temp = api.temp({
        '/': Response.json([{
            title: 'Title 1',
            path: '/post/1',
        }, {
            title: 'Title 2',
            path: '/post/2',
        }]),
    });
    const [{ id }] = await api.fetch<api.Response['subscribe']>('/api/feeds', {
        method: 'POST',
        body: {
            url: temp['/'],
            jq: `.[:10] | { title: "JQ Test", items: map({ title:.title, url: "https://example.com\\(.path)" }) }`,
        } as Module.Subscribe,
    });
    await api.fetch<api.Response['refresh']>('/api/feeds', { method: 'PUT', query: { id } });
    const res = await api.fetch<api.Response['entries']>('/api/entries', { query: { feedId: id, order: 'asc' } });
    expect(res).toMatchObject([{
        title: 'Title 1',
        url: 'https://example.com/post/1',
    }, {
        title: 'Title 2',
        url: 'https://example.com/post/2',
    }]);
});

test('plugins.scraper', async () => {
    using temp = api.temp({
        '/feed.json': Response.json({
            title: 'Scraper Test',
            items: [{
                url: '/post/1',
            }, {
                url: '/post/2',
            }],
        } satisfies JSONFeed.$Input),
        '/post/1': new Response('<!DOCTYPE html><html><body><article>Content 1</article></body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
        '/post/2': new Response('<!DOCTYPE html><html><body><article>Content 2</article></body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    });
    const [{ id }] = await api.fetch<api.Response['subscribe']>('/api/feeds', {
        method: 'POST',
        body: {
            url: temp['/feed.json'],
            scraper: 'body>article',
        } as Module.Subscribe,
    });
    await api.fetch<api.Response['refresh']>('/api/feeds', { method: 'PUT', query: { id } });
    const res = await api.fetch<api.Response['entries']>('/api/entries', { query: { feedId: id, order: 'asc' } });
    expect(res).toMatchObject([{
        content_html: '<article>Content 1</article>',
    }, {
        content_html: '<article>Content 2</article>',
    }]);
});
