import { escapeHTML } from 'bun';
import { html, raw } from 'hono/html';
import { Fragment, createElement } from 'hono/jsx';
import { CDATA } from './cdata';

type Data = {
    title: string;
    home_page_url?: string | null;
    description?: string | null;
    items: {
        id: string,
        url?: string | null;
        title?: string | null;
        content_html?: string | null;
        date_published?: Date | null;
        authors?: { name: string; }[] | null;
    }[];
};

function Atom({
    title,
    home_page_url,
    description,
    items,
}: Data, opt?: { xsl?: string; }) {
    const declaration = raw('<?xml version="1.0" encoding="UTF-8"?>');
    const PIs = [
        opt?.xsl && raw(`<?xml-stylesheet type="text/xsl" href="${escapeHTML(opt.xsl)}"?>`),
    ];
    const element = <>
        <feed xmlns="http://www.w3.org/2005/Atom">
            <title>{title}</title>
            {home_page_url && <>
                <link href={home_page_url} />
                <id>{home_page_url}</id>
                <link rel="alternate" type="text/html" href={home_page_url} />
            </>}
            <subtitle>{description}</subtitle>
            {items.map(({
                id,
                title,
                url,
                content_html,
                date_published,
                authors,
            }) => (
                <entry>
                    <id>{id}</id>
                    <title>{title}</title>
                    {content_html && <content type="html"><CDATA value={content_html} /></content>}
                    <link rel="alternate" href={url!} />
                    {date_published && <published>{date_published.toISOString()}</published>}
                    {(authors as { name?: string; }[] | undefined)?.filter(({ name }) => name).map(({ name }) => <author><name>{name}</name></author>)}
                </entry>
            ))}
        </feed>
    </>;
    return html`${declaration}${PIs}${element}`;
}

export { Atom };
