import { escapeHTML } from 'bun';
import { backMap } from './backmap';
import { WeakRefMap } from './weak-ref-collections';

const SelectHTMLRewriter = /* @__PURE__ */ backMap(new WeakRefMap(), (selector: string) => {
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
function selectHTML(selector: string, input: string) {
    return SelectHTMLRewriter(selector).transform(input).trimStart().replace(/^<!DOCTYPE( .*?)?>/i, '');
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
