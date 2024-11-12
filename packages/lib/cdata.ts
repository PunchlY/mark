import { escapeHTML } from 'bun';
import { raw } from 'hono/html';

function encodeCDATA(str: string) {
    return `<![CDATA[${str.replace(']]>', ']]]]><![CDATA[>')}]]>`;
}

function CDATA({ value }: { value: string; }) {
    return raw(encodeCDATA(value));
}

function escapeCDATA(xml: string) {
    return xml.replace(/<!\[CDATA\[(.*?)]]>/, (sub, data) => escapeHTML(data));
}

export { encodeCDATA, CDATA, escapeCDATA };
