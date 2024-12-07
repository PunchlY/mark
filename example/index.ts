import { Plugin } from 'mark:subscribe';
import { urlReplace } from './lib/url';
import { selectHTML, unescapeHTML } from './lib/html';

export default new Plugin()
    .onFetch('url-rewrite', (feed, replacement) => {
        feed.feed_url &&= urlReplace(feed.feed_url, replacement);
    })
    .onFetch('jq', async ({ feed_url }, filter) => {
        if (!feed_url)
            return;
        const text = await Bun.$`jq ${filter} < ${await Bun.fetch(feed_url)}`.text();
        return JSON.parse(text);
    })
    .onFetch(({ title, feed_url }) => {
        if (title || !feed_url)
            return;
        const url = new URL(feed_url);
        if (url.origin === 'https://rsshub.app')
            return Bun.fetch(`http://127.0.0.1:1200${url.pathname}?format=json`);
        return Bun.fetch(feed_url);
    })
    .onRewrite('url-rewrite', (item, replacement) => {
        item.url &&= urlReplace(item.url, replacement);
    })
    .onRewrite('scraper', async (item, selector) => {
        if (!item.url)
            return;
        const res = await Bun.fetch(item.url);
        const html = await res.text();
        item.content_html = selectHTML(selector, html.trimStart().replace(/^<!DOCTYPE(?: .*?)?>/i, ''));
    })
    .onRewrite('remove', (item, selector) => {
        item.content_html &&= new HTMLRewriter().on(selector, { element(e) { e.remove(); } }).transform(item.content_html);
    })
    .onRewrite('lazyload', (item, attribute) => {
        item.content_html &&= new HTMLRewriter()
            .on(`img[${attribute}]`, {
                element(element) {
                    const src = element.getAttribute(attribute)!;
                    element.removeAttribute(attribute);
                    element.setAttribute('src', src);
                },
            })
            .transform(item.content_html);
    })
    .onRewrite('rewrite-image-url', (item, replacement, feedUrl, homePage) => {
        item.content_html &&= new HTMLRewriter()
            .on('img[src]', {
                async element(e) {
                    const url = new URL(unescapeHTML(e.getAttribute('src')!), item.url || homePage || feedUrl);
                    e.setAttribute('src', Bun.escapeHTML(replacement ? urlReplace(url, replacement) : url.href));
                },
            })
            .transform(item.content_html);
    })
    .onRewrite(async (item, rewriter) => { // zhihu
        if (!item.content_html || !item.url)
            return;
        if (!new URL(item.url).hostname.endsWith('zhihu.com'))
            return;
        item.content_html = rewriter.transform(item.content_html);
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
    .onRewrite('scraper', (item) => {
        item.content_html &&= new HTMLRewriter()
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
            .transform(item.content_html);
    });
