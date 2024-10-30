import { escapeHTML, fetch } from 'bun';
import { Factory } from './subscribe';
import { selectHTML, unescapeHTML } from 'lib/html';
import { urlReplace } from 'lib/url';
import { backMap } from 'lib/backmap';
import { WeakRefMap } from 'lib/weak-ref-collections';

const htmlRewriter = Factory.rewriter(async (c, next, rewriter: HTMLRewriter) => {
    await next();
    c.item.content_html &&= rewriter.transform(c.item.content_html);
});

const scraper = Factory.rewriter(async (c, next, selector: string, init?: FetchRequestInit) => {
    const res = await fetch(c.item.url!, init);
    const html = await res.text();
    c.item.content_html = selectHTML(selector, html.trimStart().replace(/^<!DOCTYPE( .*?)?>/i, ''));
    await next();
});

const RewriteImageUrlRewriter = backMap(new WeakRefMap(), (replacement?: string, base?: string | URL) => {
    return new HTMLRewriter()
        .on('img[src]', {
            async element(e) {
                const url = new URL(unescapeHTML(e.getAttribute('src')!), base);
                e.setAttribute('src', escapeHTML(replacement ? urlReplace(url, replacement) : url.href));
            },
        });
});
const rewriteImageUrl = Factory.rewriter(async (c, next, replacement?: string) => {
    await next();
    c.item.content_html &&= RewriteImageUrlRewriter(replacement, c.item.url ?? undefined).transform(c.item.content_html);
});

const RemoveElemenRewriter = backMap(new WeakRefMap(), (selector: string) => {
    return new HTMLRewriter()
        .on(selector, {
            element(e) {
                e.remove();
            }
        });
});
const removeElement = Factory.rewriter(async (c, next, selector: string) => {
    await next();
    c.item.content_html &&= RemoveElemenRewriter(selector).transform(c.item.content_html);
});

export { htmlRewriter, scraper, rewriteImageUrl, removeElement };
