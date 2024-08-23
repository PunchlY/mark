import { raw } from 'hono/html';

function CDATA({ value }: { value: string; }) {
    return raw(`<![CDATA[${value.replace(']]>', ']]]]><![CDATA[>')}]]>`);
}

export { CDATA };
