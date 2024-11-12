import { fetch } from 'bun';
import { AsyncLocalStorage } from 'async_hooks';
import { resolve } from 'path';
import db from 'db';
import { Interval } from 'lib/timer';
import JSONFeed from './jsonfeed';

interface Handle<C extends Context, R> {
    (context: C, next: () => Promise<void>): R | void | PromiseLike<R | void>;
}
interface Middleware<C extends Context> {
    name?: string;
    handle: Handle<C, any>;
    param?: any;
}

class Context<T = any, P = any> {
    declare static parse: (value: any) => any;
    static paramStorage = new AsyncLocalStorage<any>();
    static async compose<C extends Context<any>>(middlewares: Readonly<ArrayLike<Middleware<C>>>, ctx: C, index: number): Promise<void> {
        try {
            if (index === middlewares.length)
                return;
            const middleware = middlewares[index];
            const { name, handle } = middleware;
            let { param } = middleware;
            if (name) {
                param = ctx.#options && Object.hasOwn(ctx.#options, name) && ctx.#options[name];
                if (!param)
                    return this.compose(middlewares, ctx, index + 1);
            }
            let wait;
            const res = await this.paramStorage.run(param, handle, ctx, async () => void await (wait ??= this.compose(middlewares, ctx, index + 1)));
            if (ctx.#pending) {
                ctx.#res = await this.parse(res);
                ctx.#pending = false;
                ctx.#isFresh = false;
                return;
            }
            if (ctx.#isFresh) {
                ctx.#res = await this.parse(ctx.#res);
                ctx.#isFresh = false;
            }
        } catch (error) {
            const { name, handle } = middlewares[index];
            console.error('[middleware] name=%s error=%s', name || handle.name, error);
        }
    }
    static async run<C extends Context<any>>(middlewares: Readonly<ArrayLike<Middleware<C>>>, ctx: C): Promise<C extends Context<infer T> ? T : never> {
        await this.compose(middlewares, ctx, 0);
        if (!ctx.#isFresh)
            return this.parse(ctx.#res);
        return ctx.#res;
    }
    #pending = true;
    #isFresh = false;
    #res: T;
    #options?: Record<string, string>;
    constructor(res: T, options?: Record<string, string>) {
        this.#res = res;
        this.#options = options;
    }
    get finalized() { return !this.#pending; }
    get res() { return this.#res; }
    set res(value) {
        this.#isFresh ||= this.#res !== value;
        this.#res = value;
    }
    get param(): P {
        return Context.paramStorage.getStore();
    }
}

class FetcherContext<T = any> extends Context<JSONFeed, T> {
    static parse = JSONFeed;
    #req: Request;
    constructor(url: string, options?: Subscribe.Plugins['fetch']) {
        super({ items: [], title: '' }, options);
        this.#req = new Request(url);
    }
    get req() { return this.#req; }
    set req(value) { this.#req = value; }
}
class RewriterContext<T = any> extends Context<JSONFeed.Item, T> {
    static parse = JSONFeed.Item;
    #feedUrl: string;
    #homePage?: string;
    #item: JSONFeed.Item;
    constructor(feedUrl: string, homePage: string | undefined, item: JSONFeed.Item, options?: Subscribe.Plugins['rewrite']) {
        super(item, options);
        this.#feedUrl = feedUrl;
        this.#homePage = homePage;
        this.#item = item;
    }
    get feedUrl() { return this.#feedUrl; }
    get homePage() { return this.#homePage; }
    get item() { return this.#item; }
}

namespace Subscribe {
    export interface Plugins {
        fetch?: Record<string, string>;
        rewrite?: Record<string, string>;
    }
    export interface Fetcher<T> extends Handle<FetcherContext<T>, JSONFeed.$Input> { }
    export interface Rewriter<T> extends Handle<RewriterContext<T>, JSONFeed.Item.$Input> { }
}

let Helper;
class Subscribe {
    static {
        Helper = class Helper {
            constructor(private subscribe: Subscribe) {
                subscribe.#fetcher.push({ handle: (c) => fetch(c.req) });
                subscribe.#rewriter.push({ handle: (c) => c.item });
                Object.freeze(subscribe.#fetcher);
                Object.freeze(subscribe.#rewriter);
            }
            get options() {
                return this.subscribe.#options;
            }
            async fetch(url: string, options?: Subscribe.Plugins['fetch']) {
                return await Context.run(this.subscribe.#fetcher, new FetcherContext(url, options));
            }
            async rewrite(feedUrl: string, homePage: string | undefined, item: JSONFeed.Item, options?: Subscribe.Plugins['rewrite']) {
                return await Context.run(this.subscribe.#rewriter, new RewriterContext(feedUrl, homePage, item, options));
            }
        };
    }
    #options: Record<keyof Subscribe.Plugins, Record<string, string | null>> = { fetch: {}, rewrite: {} };
    #fetcher: Middleware<FetcherContext>[] = [];
    #rewriter: Middleware<RewriterContext>[] = [];
    #on<C extends Context>(type: keyof Subscribe.Plugins, store: Middleware<C>[], args: ArrayLike<any>): string | undefined;
    #on(type: keyof Subscribe.Plugins, store: Middleware<Context>[], args: [handle: Handle<Context, any>, param: any] | [name: string, handle: Handle<Context, any>, placeholder: string]) {
        let name, handle, placeholder, param;
        if (typeof args[0] === 'function')
            handle = args[0], param = args[1];
        if (typeof args[1] === 'function') {
            name = String(args[0]), handle = args[1], placeholder = args[2] ? String(args[2]) : undefined;
            if (Object.hasOwn(this.#options[type], name))
                throw new Error(`Duplicate registration ${type}[${JSON.stringify(name)}]`);
            this.#options[type][name] = placeholder ?? null;
        }
        if (!handle)
            throw new TypeError(`${handle} is not a function`);
        store.push({ name, handle, param });
        return name;
    }
    onFetch(name: string, fetch: Subscribe.Fetcher<string>, placeholder?: string): this;
    onFetch<T>(fetch: Subscribe.Fetcher<T>, param: T): this;
    onFetch(fetch: Subscribe.Fetcher<undefined>): this;
    onFetch() {
        this.#on('fetch', this.#fetcher, arguments);
        return this;
    }
    onRewrite(name: string, rewrite: Subscribe.Rewriter<string>, placeholder?: string): this;
    onRewrite<T>(rewrite: Subscribe.Rewriter<T>, param: T): this;
    onRewrite(rewrite: Subscribe.Rewriter<undefined>): this;
    onRewrite() {
        this.#on('rewrite', this.#rewriter, arguments);
        return this;
    }
}

const cleanStmt = db.query<null, []>(`DELETE FROM Item WHERE read=1 AND star=0 AND id IN (SELECT Item.id FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id WHERE clean>0 AND unixepoch("now")-ifnull(Item.updatedAt,Item.createdAt)>=clean)`);
const readStmt = db.query<null, []>(`UPDATE Item SET read=1 WHERE read=0 AND star=0 AND id IN (SELECT Item.id FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id WHERE markRead>0 AND unixepoch("now")-ifnull(Item.updatedAt,Item.createdAt)>=markRead)`);
const updateFeedStmt = db.query<null, [title: string, home_page_url: string | null, ids: string | null, id: number]>(`UPDATE Feed SET title=?,homePage=?,ids=?,errorCount=0 WHERE id=?`);
const feedErrorAddStmt = db.query<null, [id: number]>(`UPDATE Feed SET errorCount=errorCount+1 WHERE id=?`);
const findItemStmt = db.query<{ id: number; }, [key: string, feedId: number]>('SELECT id FROM Item WHERE key=? AND feedId=?');
const insertItemStmt = db.query<null, [key: string, url: string | null, title: string | null, contentHtml: string | null, datePublished: string | null, authors: string | null, feedId: number]>(`INSERT INTO Item (key,url,title,contentHtml,datePublished,authors,feedId) VALUES (?,?,?,?,unixepoch(?),?,?)`);
const feedUpdatedStmt = db.query<{ id: number, url: string, ids: string | null, plugins: string | null; }, []>(`SELECT id, url, plugins, ids FROM Feed WHERE refresh>0 AND (ifnull(updatedAt,1) OR refresh<=unixepoch("now")-updatedAt)`);
const findFeedStmt = db.query<{ id: number, url: string, ids: string | null, plugins: string | null; }, [id: number]>(`SELECT id, url, plugins plugin, ids FROM Feed WHERE id=?`);

class Job extends Helper {
    timer = new Interval(async () => {
        cleanStmt.run();
        readStmt.run();
        for (const { id, url, ids, plugins } of feedUpdatedStmt.all())
            await this.#refresh(id, url, ids ? JSON.parse(ids) : undefined, plugins ? JSON.parse(plugins) : undefined);
    }, 60 * 1000);
    async #refresh(id: number, url: string, ids: Set<string>, plugins?: Subscribe.Plugins) {
        try {
            const {
                title,
                home_page_url,
                items,
            } = await super.fetch(url, plugins?.fetch);
            const newIds = [];
            for (const item of items) try {
                if (!ids.has(item.id) && !findItemStmt.get(item.id, id))
                    await this.#insert(id, url, item, home_page_url ?? undefined);
                newIds.push(item.id);
                console.debug('[insert] feedId=%d id=%s', id, item.id);
            } catch (error) {
                console.error('[insert] feedId=%d id=%s error=%s', id, item.id, error);
            }
            updateFeedStmt.run(title, home_page_url ?? null, JSON.stringify(newIds), id);
            console.debug('[refresh] feedId=%d', id);
        } catch (error) {
            console.error('[refresh] feedId=%d error=%s', id, error);
            feedErrorAddStmt.run(id);
        }
    }
    async #insert(feedId: number, feedUrl: string, item: JSONFeed.Item, homePage?: string, plugins?: Subscribe.Plugins) {
        const key = item.id, date_published = item.date_published?.toISOString() ?? null;
        const {
            url,
            title,
            content_html,
            authors,
        } = await super.rewrite(feedUrl, homePage, item, plugins?.rewrite);
        insertItemStmt.get(key, url ?? null, title ?? null, content_html ?? null, date_published, (authors && JSON.stringify(authors)) ?? null, feedId);
        return key;
    }
    async refresh(id: number) {
        const feed = findFeedStmt.get(id);
        if (!feed)
            return;
        const { url, ids, plugins } = feed;
        await this.#refresh(id, url, ids ? JSON.parse(ids) : undefined, plugins ? JSON.parse(plugins) : undefined);
    }
    async test(url: string, options?: Subscribe.Plugins) {
        const feed = await super.fetch(url, options?.fetch);
        feed.items = await Promise.all(feed.items.map((item) => super.rewrite(url, feed.home_page_url ?? undefined, item, options?.rewrite)));
        return feed;
    }
    static async entry(entrypoint?: string) {
        const subscribe = entrypoint ? (await import(resolve(process.cwd(), entrypoint))).default : new Subscribe();
        const job = new this(subscribe);
        job.timer.restart();
        return job;
    }
}

export { Subscribe, Job };
