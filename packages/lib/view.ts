function CDATA(str: string) {
    return `<![CDATA[${str.replace(']]>', ']]]]><![CDATA[>')}]]>`;
}

function* atom({
    title,
    home_page_url,
    items,
}: {
    title: string;
    home_page_url?: string | null;
    items: {
        id: string,
        url?: string | null;
        title?: string | null;
        content_html?: string | null;
        date_published?: Date | null;
        authors?: { name: string; }[] | null;
    }[];
}, opt?: { xsl?: string; }) {
    yield '<?xml version="1.0" encoding="UTF-8"?>';
    if (opt?.xsl)
        yield `<?xml-stylesheet type="text/xsl" href="${Bun.escapeHTML(opt.xsl)}"?>`;
    yield '<feed xmlns="http://www.w3.org/2005/Atom">';
    yield `<title>${Bun.escapeHTML(title)}</title>`;
    if (home_page_url) {
        const url = Bun.escapeHTML(home_page_url);
        yield `<link href="${url}"/>`;
        yield `<id>${url}</id>`;
        yield `<link rel="alternate" type="text/html" href="${url}"/>`;
    }
    for (const { id, title, url, content_html, date_published, authors } of items) {
        yield '<entry>';
        yield `<id>${Bun.escapeHTML(id)}</id>`;
        if (title)
            yield `<title>${Bun.escapeHTML(title)}</title>`;
        if (content_html)
            yield `<content type="html">${CDATA(content_html)}</content>`;
        if (url)
            yield `<link rel="alternate" href="${Bun.escapeHTML(url)}"/>`;
        if (date_published)
            yield `<published>${Bun.escapeHTML(date_published.toISOString())}</published>`;
        if (authors) for (const { name } of authors) 
            yield `<author><name>${Bun.escapeHTML(name)}</name></author>`;
        yield '</entry>';
    }
    yield '</feed>';
}

export { atom };
