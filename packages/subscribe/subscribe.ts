import { z } from 'zod';
import JSONFeed from './jsonfeed';
import { backMapConstruct } from 'lib/backmap';

const nameSchema = z.string().min(1);
const urlSchema = z.string().url();
const intervalSchema = z.number().positive().or(z.boolean().transform((value) => value && undefined));

namespace Job {
    interface Handle<C, R, P extends any[]> {
        (ctx: C, next: () => Promise<void>, ...args: P): R | PromiseLike<R>;
    }
    export interface Fetcher<T extends any[]> extends Handle<{
        req: Request;
        res: JSONFeed;
        readonly finalized: boolean;
    }, JSONFeed.$Input | void, T> { }
    export interface Rewriter<T extends any[]> extends Handle<{
        readonly item: JSONFeed.Item;
        res: JSONFeed.Item;
        readonly finalized: boolean;
    }, JSONFeed.Item.$Input | void, T> { }
}
abstract class Job {
    static defaultFetcher: [Job.Fetcher<[]>, []] = [({ req }) => fetch(req), []];
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
    #fetcher: [cb: Job.Fetcher<any>, params: any[]][] = [];
    fetch<T extends any[], C extends Job.Fetcher<T> = Job.Fetcher<T>>(fetch: C, ...params: C extends Job.Fetcher<infer P> ? P : T): this {
        this.#fetcher.push([fetch, params]);
        return this;
    }
    #rewriter: [cb: Job.Rewriter<any>, params: any[]][] = [];
    rewrite<T extends any[], C extends Job.Rewriter<T> = Job.Rewriter<T>>(rewrite: C, ...params: C extends Job.Rewriter<infer P> ? P : T) {
        this.#rewriter.push([rewrite, params]);
        return this;
    }
    #refresh?: number | false;
    refresh(seconds: number | boolean) {
        this.#refresh = intervalSchema.parse(seconds);
        return this;
    }
    #clean?: number | false;
    clean(seconds: number | boolean) {
        this.#clean = intervalSchema.parse(seconds);
        return this;
    }
    #read?: number | false;
    markRead(seconds: number | boolean) {
        this.#read = intervalSchema.parse(seconds);
        return this;
    }
}

class Category extends Job {
    static #list = new Map<string, Category>();
    static construct = backMapConstruct(this.#list, this);
    static get(category: string) {
        return this.#list.get(category);
    }
}

class Feed extends Job {
    static #list = new Map<string, Feed>();
    static construct = backMapConstruct(this.#list, this);
    static async test(url: string, category?: string) {
        const feed = this.construct(url) ?? new this(url);
        return await new Subscribe(feed.#data(category)).test();
    }
    static *[Symbol.iterator]() {
        for (const subscribe of this.#list.values())
            yield subscribe.#data();
    }
    #data(categoryName?: string) {
        const feed = Job.getData(this);
        const fetcher = [...feed.fetcher], rewriter = [...feed.rewriter];
        let { refresher, cleaner, reader } = feed;
        if (!this.#unsubscribe || categoryName)
            for (const category of [
                Category.get(categoryName ? nameSchema.parse(categoryName) : this.#category),
                Category.get(''),
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

function once<T extends (this: any, ...args: any) => any>(func: T, thisArg: ThisParameterType<T>, ...args: Parameters<T>) {
    let wait;
    return async () => void await (wait ??= Reflect.apply(func, thisArg, args));
}
async function compose(this: ArrayLike<[cb: (context: any, next: () => Promise<void>, ...args: any[]) => any, params: any[]]>, index: number, context: { finalized: boolean, res: object; } & Record<any, any>, parse: (value: any) => any): Promise<any> {
    if (this.length === index) return;
    const [cb, params] = this[index];
    const res = await cb(Object.create(context), once(compose, this, index + 1, context, parse), ...params);
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
        await compose.call(this.fetcher, 0, {
            get req() { return req; },
            set req(value) { req = value; },
            get res() { return res; },
            set res(value) { res = value; },
            finalized: false,
        }, JSONFeed);
        return res;
    }
    async rewrite(item: JSONFeed.Item) {
        await compose.call(this.rewriter, 0, {
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
    export const fetcher: <T extends any[]>(fetch: Job.Fetcher<T>) => typeof fetch = Factory;
    export const rewriter: <T extends any[]>(rewrite: Job.Rewriter<T>) => typeof rewrite = Factory;
}

function category(): Category;
function category(name: string, ...feeds: Feed[]): Category;
function category(name?: string, ...feeds: Feed[]) {
    if (arguments.length === 0) {
        name = '';
    } else {
        name = nameSchema.parse(name);
        for (const feed of feeds)
            Feed.setCategory(feed, name);
    }
    return Category.construct(name);
}

function subscribe(url: string) {
    url = urlSchema.parse(url);
    return Feed.construct(url);
}

export type { Job };
export { Feed, Category, Subscribe, Factory, category, subscribe };
