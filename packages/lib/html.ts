
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

export { unescapeHTML };
