import { z } from 'zod';
import { GetCache, GetCacheList, Instance } from 'lib/cache';
import JSONFeed from './jsonfeed';

const nameSchema = z.string().min(1);
const urlSchema = z.string().url();

namespace Job {
    export interface Fetcher<T> {
        (ctx: {
            readonly url: URL;
            res: JSONFeed;
            readonly finalized: boolean;
            param: T;
        }, next: () => Promise<void>): JSONFeed.$Input | void | PromiseLike<JSONFeed.$Input | void>;
    }
    export interface Rewriter<T> {
        (ctx: {
            readonly item: JSONFeed.Item;
            res: JSONFeed.Item;
            readonly finalized: boolean;
            param: T;
        }, next: () => Promise<void>): JSONFeed.Item.$Input | void | PromiseLike<JSONFeed.Item.$Input | void>;
    }
}
abstract class Job {
    static defaultFetcher = [(ctx: { url: URL; }) => fetch(ctx.url)] as [(ctx: { url: URL; }) => Promise<Response>];
    static getData(job: Job) {
        return {
            key: job.#key,
            fetcher: job.#fetcher,
            rewriter: job.#rewriter,
            refresher: job.#refresher,
            cleaner: job.#cleaner,
            unreadCleaner: job.#unreadCleaner,
        };
    }
    #key: string;
    constructor(key: string) {
        this.#key = key;
    }
    #fetcher: [cb: Job.Fetcher<any>, param?: any][] = [];
    fetcher(fetch: Job.Fetcher<undefined>): this;
    fetcher<T>(fetch: Job.Fetcher<T>, param: T): this;
    fetcher<T>(fetch: Job.Fetcher<T>, param?: T) {
        this.#fetcher.push([fetch, param]);
        return this;
    }
    #rewriter: [cb: Job.Rewriter<any>, param?: any][] = [];
    rewriter(rewrite: Job.Rewriter<undefined>): this;
    rewriter<T>(rewrite: Job.Rewriter<T>, param: T): this;
    rewriter<T>(rewrite: Job.Rewriter<T>, param?: T) {
        this.#rewriter.push([rewrite, param]);
        return this;
    }
    #refresher?: string | Date | false;
    refresher(cron?: string | Date | boolean) {
        if (cron === true)
            cron = undefined;
        this.#refresher = cron;
        return this;
    }
    #cleaner?: string | Date | false;
    cleaner(cron?: string | Date | boolean) {
        if (cron === true)
            cron = undefined;
        this.#cleaner = cron;
        return this;
    }
    #unreadCleaner?: string | Date | false;
    unreadCleaner(cron?: string | Date | boolean) {
        if (cron === true)
            cron = undefined;
        this.#unreadCleaner = cron;
        return this;
    }
}

class Category extends Job { }

class Feed extends Job {
    static async test(url: string, category?: string) {
        const feed = GetCache(this, url) ?? new this(url);
        return await new Subscribe(feed.#data(category)).test();
    }
    static *[Symbol.iterator]() {
        for (const [, subscribe] of GetCacheList(Feed))
            yield subscribe.#data();
    }
    #data(categoryName?: string) {
        const feed = Job.getData(this)!;
        const fetcher = [...feed.fetcher], rewriter = [...feed.rewriter];
        let { refresher, cleaner, unreadCleaner } = feed;
        if (!this.#unsubscribe || categoryName)
            for (const category of [
                GetCache(Category, categoryName ? nameSchema.parse(categoryName) : this.#category),
                GetCache(Category, ''),
            ]) if (category) {
                const data = Job.getData(category);
                fetcher.push(...data.fetcher);
                rewriter.push(...data.rewriter);
                refresher ??= data.refresher;
                cleaner ??= data.cleaner;
                unreadCleaner ??= data.unreadCleaner;
            }
        fetcher.push(Job.defaultFetcher);
        return {
            fetcher,
            rewriter,
            refresher,
            cleaner,
            unreadCleaner,
            url: feed.key,
            category: this.#category,
            unsubscribe: this.#unsubscribe,
        };
    }
    #category = 'Uncategorized';
    category(name: string) {
        name = nameSchema.parse(name);
        this.#category = name;
        return this;
    }
    #unsubscribe = false;
    unsubscribe() {
        this.#unsubscribe = true;
    }
}
namespace Feed {
    type GeneratorResult<T> = T extends Generator<infer R> ? R : never;
    export interface Data extends GeneratorResult<ReturnType<typeof Feed[typeof Symbol.iterator]>> { }
}


function Once(func: () => Promise<any>, wait?: Promise<any>) {
    return async () => void await (wait ??= func());
}
async function Compose(this: ArrayLike<[cb: (context: any, next: () => Promise<void>) => any, param?: any]>, index: number, context: { finalized: boolean, res: object; } & Record<any, any>, parse: (value: any) => any): Promise<any> {
    if (this.length === index) return;
    const [cb, param] = this[index];
    const ctx = Object.create(context);
    ctx.param = param;
    const res = await cb(ctx, Once(Compose.bind(this, index + 1, context, parse)));
    if (context.finalized)
        return;
    if (res)
        context.res = await parse(res);
    context.finalized = true;
}

interface Subscribe extends Feed.Data { }
class Subscribe {
    constructor(opt: Feed.Data) {
        Object.assign(this, opt);
    }
    async fetch() {
        const url = new URL(this.url);
        let res: JSONFeed = { title: this.url, items: [], authors: null };
        await Compose.call(this.fetcher, 0, {
            url,
            get res() { return res; },
            set res(value) { res = value; },
            finalized: false,
        }, JSONFeed);
        return res || await JSONFeed(await fetch(url));
    }
    async rewrite(item: JSONFeed.Item) {
        await Compose.call(this.rewriter, 0, {
            item,
            get res() { return item; },
            set res(value) { item = value; },
            finalized: false,
        }, JSONFeed.Item);
        return item;
    }
    async test() {
        const feed = await this.fetch();
        const items = [];
        for (const item of feed.items)
            items.push(await this.rewrite(item));
        feed.items = items.filter(Boolean as unknown as (e: any) => e is JSONFeed.Item);
        return feed;
    }
}

namespace Factory {
    const Factory = (cb: (...args: any[]) => any) => cb;
    export const fetcher: <T>(fetch: Job.Fetcher<T>) => typeof fetch = Factory;
    export const rewriter: <T>(rewrite: Job.Rewriter<T>) => typeof rewrite = Factory;
}

function category(name?: string) {
    if (arguments.length === 0)
        name = '';
    else
        name = nameSchema.parse(name);
    return Instance(Category, name);
}

function subscribe(url: string) {
    url = urlSchema.parse(url);
    return Instance(Feed, url);
}

export type { Job };
export { Feed, Category, Subscribe, Factory, category, subscribe };
