import { z } from 'zod';
import { GetCache, GetCacheList, Instance } from 'lib/cache';
import JSONFeed from './jsonfeed';

const cronSchema = z.string();
const nameSchema = z.string().min(1);
const urlSchema = z.string().url();
const intervalSchema = z.number().positive();

namespace Job {
    interface Handle<C, R> {
        (ctx: C, next: () => Promise<void>): R | PromiseLike<R>;
    }
    export interface Fetcher<T> extends Handle<{
        req: Request;
        res: JSONFeed;
        readonly finalized: boolean;
        readonly param: T;
    }, JSONFeed.$Input | void> { }
    export interface Rewriter<T> extends Handle<{
        readonly item: JSONFeed.Item;
        res: JSONFeed.Item;
        readonly finalized: boolean;
        readonly param: T;
    }, JSONFeed.Item.$Input | void> { }
}
abstract class Job {
    static defaultFetcher = [({ req }) => fetch(req)] as [(ctx: { req: Request; }) => Promise<Response>];
    static getData(job: Job) {
        return {
            key: job.#key,
            fetcher: job.#fetcher,
            rewriter: job.#rewriter,
            refresher: job.#refresh,
            cleaner: job.#clean,
            reader: job.#read,
        };
    }
    #key: string;
    constructor(key: string) {
        this.#key = key;
    }
    #fetcher: [cb: Job.Fetcher<any>, param?: any][] = [];
    fetch(fetcher: Job.Fetcher<undefined>): this;
    fetch<T>(fetch: Job.Fetcher<T>, param: T): this;
    fetch(fetch: Job.Fetcher<any>, param?: any) {
        this.#fetcher.push([fetch, param]);
        return this;
    }
    #rewriter: [cb: Job.Rewriter<any>, param?: any][] = [];
    rewrite(rewriter: Job.Rewriter<undefined>): this;
    rewrite<T>(rewrite: Job.Rewriter<T>, param: T): this;
    rewrite(rewrite: Job.Rewriter<any>, param?: any) {
        this.#rewriter.push([rewrite, param]);
        return this;
    }
    #refresh?: string;
    refresh(cron: string) {
        this.#refresh = cronSchema.parse(cron);
        return this;
    }
    #clean?: number;
    clean(hour: number) {
        this.#clean = intervalSchema.parse(hour);
        return this;
    }
    #read?: number;
    markRead(hour: number) {
        this.#read = intervalSchema.parse(hour);
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
        const feed = Job.getData(this);
        const fetcher = [...feed.fetcher], rewriter = [...feed.rewriter];
        let { refresher, cleaner, reader } = feed;
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
                reader ??= data.reader;
            }
        fetcher.push(Job.defaultFetcher);
        return {
            fetcher,
            rewriter,
            refresher,
            cleaner,
            reader,
            url: feed.key,
            category: this.#category,
            unsubscribe: this.#unsubscribe,
        };
    }
    static setCategory(feed: Feed, name: string) {
        feed.#category = name;
    }
    #category = 'Uncategorized';
    get category() {
        return this.#category;
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

function Once<T extends (this: any, ...args: any) => any>(func: T, thisArg: ThisParameterType<T>, ...args: Parameters<T>) {
    let wait;
    return async () => void await (wait ??= Reflect.apply(func, thisArg, args));
}
async function Compose(this: ArrayLike<[cb: (context: any, next: () => Promise<void>) => any, param?: any]>, index: number, context: { finalized: boolean, res: object; } & Record<any, any>, parse: (value: any) => any): Promise<any> {
    if (this.length === index) return;
    const [cb, param] = this[index];
    const res = await cb(Object.create(context, {
        param: { get() { return param; } },
    }), Once(Compose, this, index + 1, context, parse));
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
        let req = new Request(this.url);
        let res: JSONFeed = { title: this.url, items: [] };
        await Compose.call(this.fetcher, 0, {
            get req() { return req; },
            set req(value) { req = value; },
            get res() { return res; },
            set res(value) { res = value; },
            finalized: false,
        }, JSONFeed);
        return res;
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
        feed.items = await Promise.all(feed.items.map(this.rewrite, this));
        return feed;
    }
}

namespace Factory {
    const Factory = (cb: (...args: any[]) => any) => cb;
    export const fetcher: <T>(fetch: Job.Fetcher<T>) => typeof fetch = Factory;
    export const rewriter: <T>(rewrite: Job.Rewriter<T>) => typeof rewrite = Factory;
}

function category(name?: string, ...feeds: Feed[]) {
    if (arguments.length === 0) {
        name = '';
    } else {
        name = nameSchema.parse(name);
        for (const feed of feeds)
            Feed.setCategory(feed, name);
    }
    return Instance(Category, name);
}

function subscribe(url: string) {
    url = urlSchema.parse(url);
    return Instance(Feed, url);
}

export type { Job };
export { Feed, Category, Subscribe, Factory, category, subscribe };
