
declare module 'mark:subscribe' {
    export { onFetch, onRewrite } from 'subscribe';
    export { JSONFeed } from 'subscribe/jsonfeed';
}

declare module '*.sql' {
    const sql: string;
    export default sql;
}
