import { $, fetch } from 'bun';
import { Subscribe } from 'mark:subscribe';
import { urlReplace } from './lib/url';
import { selectHTML, unescapeHTML, escapeHTML } from './lib/html';
import { bucket } from './lib/bucket';
import { WeakRefMap } from './lib/weak-ref-collections';

const RewriteImageUrlRewriter = bucket(new WeakRefMap(), (replacement?: string) => {
    return new HTMLRewriter()
        .on('img[src]', {
            async element(e) {
                const url = new URL(unescapeHTML(e.getAttribute('src')!));
                e.setAttribute('src', escapeHTML(replacement ? urlReplace(url, replacement) : url.href));
            },
        });
});
const RemoveElemenRewriter = bucket(new WeakRefMap(), (selector: string) => {
    return new HTMLRewriter()
        .on(selector, {
            element(e) {
                e.remove();
            }
        });
});

export default new Subscribe()
    .onFetch('url-rewrite', async (c) => {
        c.req = new Request(urlReplace(c.req.url, c.param), c.req);
    }, 'replacement')
    .onFetch('jq', async (c) => {
        const text = await $`jq ${c.param} < ${await fetch(c.req)}`.text();
        return JSON.parse(text);
    }, 'filter')
    .onFetch((c, next) => {
        if (c.req.method !== 'GET')
            return next();
        const url = new URL(c.req.url);
        if (url.origin === 'https://rsshub.app')
            return fetch(`http://127.0.0.1:1200${url.pathname}?format=json`);
        return fetch(c.req);
    })
    .onRewrite(async (c, next) => {
        await next();
        c.res.content_html &&= c.param.transform(c.res.content_html);
    }, new HTMLRewriter()
        .onDocument({
            comments(doc) {
                doc.remove();
            },
        })
        .on('link, script, style, noscript, [hidden]', {
            element(e) {
                e.remove();
            }
        })
        .on('div:not([style]), span:not([style]), article:not([style])', {
            element(e) {
                e.removeAndKeepContent();
            },
        })
        .on('*', {
            element(e) {
                e.removeAttribute('class');
            },
        })
    )
    .onRewrite('remove', async (c, next) => {
        await next();
        c.res.content_html &&= RemoveElemenRewriter(c.param).transform(c.res.content_html);
    }, 'selector')
    .onRewrite(async (c, next) => { // zhihu
        await next();
        const item = c.res;
        if (!item.content_html || !item.url)
            return;
        if (!new URL(item.url).hostname.endsWith('zhihu.com'))
            return;
        item.content_html = c.param.transform(item.content_html);
    }, ((ref_n: Record<string, number> = {}, referencelist: string[] = []) => new HTMLRewriter()
        .onDocument({
            end(end) {
                if (referencelist.length)
                    end.append(`<h2>参考</h2><ol>${referencelist.join('')}</ol>`, { html: true });
                ref_n = {};
                referencelist = [];
            },
        })
        .on('[data-draft-type="reference"]', {
            element(element) {
                const numero = element.getAttribute('data-numero')!;
                const text = element.getAttribute('data-text');
                const url = element.getAttribute('data-url');
                ref_n[numero] ??= 0;
                const id = `ref_${numero}_${ref_n[numero]++}`;
                const refId = `ref_${numero}`;

                element.replace(`<a id="${id}" href="#${refId}"><sup>[${numero}]</sup></a>`, { html: true });

                referencelist.push(`<li><a id="${refId}" href="#${id}">^</a> ${text ?? ''} ${url ? `<a href="${url}">${url}</a>` : ''}</li>`);
            },
        }))())
    .onRewrite('rewrite-image-url', async (c, next) => {
        await next();
        c.res.content_html &&= RewriteImageUrlRewriter(c.param).transform(c.res.content_html);
    }, 'replacement')
    .onRewrite('url-rewrite', async (c) => {
        c.item.url &&= urlReplace(c.item.url, c.param);
    }, 'replacement')
    .onRewrite('scraper', async (c) => {
        const res = await fetch(c.item.url!);
        const html = await res.text();
        c.item.content_html = selectHTML(c.param, html.trimStart().replace(/^<!DOCTYPE( .*?)?>/i, ''));
        return c.item;
    }, 'selector');
