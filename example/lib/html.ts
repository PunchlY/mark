import { escapeHTML } from 'bun';
import { bucket } from './bucket';
import { WeakRefMap } from './weak-ref-collections';

const SelectHTMLRewriter = /* @__PURE__ */ bucket(new WeakRefMap(), (selector: string) => {
    let depth = 0;
    return new HTMLRewriter()
        .onDocument({
            end() {
                depth = 0;
            },
        })
        .on(selector, {
            element(e) {
                depth++;
                e.onEndTag(() => { depth--; });
            },
        })
        .on('*', {
            element(e) {
                if (e.removed || depth)
                    return;
                e.removeAndKeepContent();
            },
            text(e) {
                if (e.removed || depth)
                    return;
                e.remove();
            },
        });
});
function selectHTML(selector: string, input: Response | Blob | Bun.BufferSource): Response;
function selectHTML(selector: string, input: string): string;
function selectHTML(selector: string, input: ArrayBuffer): ArrayBuffer;
function selectHTML(selector: string, input: any): unknown {
    return SelectHTMLRewriter(selector).transform(input);
}

function unescapeHTML(htmlString: string) {
    return htmlString.replaceAll(/&([A-Za-z]+);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (sub, name, code, code16) => {
        if (code16)
            return String.fromCodePoint(parseInt(code16, 16));
        if (code)
            return String.fromCodePoint(parseInt(code, 10));
        switch (name) {
            case 'quot': return '"'; // 34
            case 'amp': return '&'; // 38
            case 'lt': return '<'; // 60
            case 'gt': return '>'; // 60
            default: return sub;
        }
    });
}

export { selectHTML, unescapeHTML, escapeHTML };
