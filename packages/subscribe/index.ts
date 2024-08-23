import { plugin, resolve } from 'bun';
import JSONFeed from './jsonfeed';
import db from 'db';
import { Cron, type CronOptions } from 'croner';

const cronOptions: CronOptions = {
    interval: 60,
    catch(err) {
        console.error(err);
    },
};

namespace Job {
    type Readonly<T, K extends keyof T> = {
        readonly [P in K]: T[P];
    } & Omit<T, K>;
    export type fetchData = Response | string | JSONFeed.$Input;
    export type feed = JSONFeed;
    export type item = Readonly<JSONFeed.Item, 'id' | 'date_published'>;
    export type cleanerOpts = {
        unread?: string | number | Date | null;
        read?: string | number | Date | null;
    };
    export type cleaner = {
        unread: Date | null;
        read: Date;
    };
}

abstract class Job {
    #croner?: Cron;
    get croner() {
        if (this.#croner && !this.#croner.isStopped())
            return this.#croner;
    }
    cron(pattern: string | Date) {
        if (this.#croner && this.#croner.getPattern() === pattern)
            return this;
        this.#croner?.stop();
        this.#croner = Cron(pattern, cronOptions);
        return this;
    }

    #urlRewriter: ((url: URL) => Promise<void>)[] = [];
    async urlRewrite(url: string | URL) {
        url = url instanceof URL ? url : new URL(url);
        for (const rewriter of this.#urlRewriter)
            await rewriter(url);
        return url;
    }
    urlRewriter<T extends any[]>(cb: (url: URL, ...args: T) => void | PromiseLike<void>, ...param: T) {
        this.#urlRewriter.push(async (feed) => await cb(feed, ...param));
        return this;
    }

    #fetch: [(url: URL) => Promise<Job.fetchData>] | [] = [];
    get fetch() {
        return this.#fetch[0];
    }
    setFetch<T extends any[]>(fetch: (url: URL, ...args: T) => Job.fetchData | PromiseLike<Job.fetchData>, ...param: T): this;
    setFetch<T extends any[]>(fetch: (url: URL, ...args: T) => any, ...param: T): this;
    setFetch<T extends any[]>(fetch: (url: URL, ...args: T) => Job.fetchData | PromiseLike<Job.fetchData>, ...param: T) {
        this.#fetch[0] = async (url) => await fetch(url, ...param);
        return this;
    }

    #feedRewriter: ((feed: Job.feed) => any)[] = [];
    async feedRewrite(feed: Job.feed) {
        for (const rewriter of this.#feedRewriter)
            await rewriter(feed);
        return feed;
    }
    feedRewriter<T extends any[]>(cb: (feed: Job.feed, ...args: T) => void | PromiseLike<void>, ...param: T) {
        this.#feedRewriter.push((feed) => cb(feed, ...param));
        return this;
    }

    #rewriter: ((item: Job.item) => any)[] = [];
    async rewrite(item: Job.item) {
        for (const rewriter of this.#rewriter)
            await rewriter(item);
        return item;
    }
    rewriter<T extends any[]>(cb: (item: Job.item, ...args: T) => void | PromiseLike<void>, ...param: T) {
        this.#rewriter.push((item) => cb(item, ...param));
        return this;
    }

    #cleaner: [() => Promise<Job.cleaner>] | [] = [];
    get cleaner() {
        return this.#cleaner[0];
    }
    setCleaner<T extends any[]>(cb: ((...args: T) => Job.cleanerOpts | PromiseLike<Job.cleanerOpts>), ...args: T) {
        this.#cleaner[0] = async () => {
            let { unread, read } = await cb(...args);
            read ??= unread;
            unread ??= null;
            if (unread !== null && !(unread instanceof Date))
                unread = new Date(unread);
            read ??= new Date();
            if (!(read instanceof Date))
                read = new Date(read);
            return { unread, read };
        };
        return this;
    }

    freeze() {
        Object.freeze(this.#urlRewriter);
        Object.freeze(this.#fetch);
        Object.freeze(this.#feedRewriter);
        Object.freeze(this.#rewriter);
        Object.freeze(this.#cleaner);
        return this;
    }
}

class Group extends Job {
    static global = new this('Global');
    static list = new Map<string, Group>();
    static find(name: string | Group) {
        if (name instanceof Group)
            return name;
        return this.list.get(name);
    }
    static get(name: string | Group) {
        if (name instanceof Group)
            return name;
        name = String(name || '');
        let group = this.list.get(name);
        if (group)
            return group;
        group = new this(name);
        this.list.set(name, group);
        return group;
    }
    static put(name: string | Group, subscribe: Subscribe) {
        const group = this.get(name);
        group.#sub.add(subscribe);
        return group;
    }
    static delete(name: string | Group, subscribe: Subscribe) {
        const group = this.find(name);
        if (!group)
            return;
        group.#sub.delete(subscribe);
    }
    #sub = new Set<Subscribe>();
    #name: string;
    get name() {
        return this.#name;
    }
    protected constructor(name: string) {
        super();
        this.#name = name;
    }
    async clean() {
        for (const feed of this.#sub.values())
            await feed.clean();
    }
    async update() {
        for (const feed of this.#sub.values())
            await feed.update();
    }
    async refresh() {
        for (const feed of this.#sub.values())
            await feed.refresh();
    }
    cron(pattern: string | Date) {
        super.cron(pattern);
        super.croner!.schedule(async () => {
            for (const feed of this.#sub.values())
                if (Subscribe.cronerIs(feed, this)) {
                    await feed.refresh();
                    await feed.clean();
                }
        });
        return this;
    }
}

const findCategoryQuery = db.query<{ id: number; }, [name: string]>(`SELECT id FROM Category WHERE name=?`);
const insertCategoryQuery = db.query<{ id: number; }, [name: string]>(`INSERT INTO Category (name) VALUES (?) RETURNING id`);

class Category extends Group {
    static list = new Map<string, Category>();
    declare static find: (name: string | Category) => Category;
    declare static get: (name: string | Category) => Category;
    declare static put: (name: string | Category, subscribe: Subscribe) => Category;
    declare static delete: (name: string | Category, subscribe: Subscribe) => Category;
    #id: number;
    get id() {
        return this.#id;
    }
    constructor(name: string) {
        super(name);
        this.#id = findCategoryQuery.get(name)?.id ??
            insertCategoryQuery.get(name)?.id!;
    }
}

const subscribeQuery = db.query<null, [number]>(`INSERT OR IGNORE INTO Subscribe (id) VALUES (?)`);
const unsubscribeQuery = db.query<null, [number]>(`DELETE FROM Subscribe WHERE id=?`);

const findFeedQuery = db.query<{ id: number; title: string | null, category: string; }, [url: string]>(`SELECT Feed.id, Feed.title, Category.name category FROM Feed LEFT JOIN Category ON Feed.categoryId = Category.id WHERE url=?`);
const insertFeedQuery = db.query<{ id: number; }, [url: string, category: number]>(`INSERT INTO Feed (url,categoryId) VALUES (?,?) RETURNING id`);
const updateFeedCategoryQuery = db.query<null, [categoryId: number, id: number]>(`UPDATE Feed SET categoryId=? WHERE id=?`);
const updateFeedQuery = db.query<null, [title: string, home_page_url: string | null, description: string | null, authors: string | null, id: number]>(`UPDATE Feed SET title=?,homePage=?,description=?,authors=? WHERE id=?`);

const hasItemQuery = db.query<{ id: number; }, [key: string, feedId: number]>('SELECT id FROM Item WHERE key=?1 AND feedID=?2 UNION SELECT id FROM CleanedItem WHERE key=?1 AND feedID=?2');
const insertItemQuery = db.query<null, [key: string, url: string | null, title: string | null, contentHtml: string | null, datePublished: string | null, authors: string | null, feedId: number]>(`INSERT INTO Item (key,url,title,contentHtml,datePublished,authors,feedId) VALUES (?,?,?,?,unixepoch(?),?,?)`);

const cleanQuery = db.query<null, [id: number, unread: string | null, read: string]>(`DELETE FROM Item WHERE id IN (SELECT Item.id FROM Item JOIN Feed ON Item.feedId = Feed.id WHERE Feed.id=?1 AND Item.star=0 AND ((Item.read=0 AND ifnull(Item.datePublished,Item.createdAt)<=unixepoch(?2)) OR (Item.read=1 AND ifnull(Item.datePublished,Item.createdAt)<=unixepoch(?3))))`);

class Subscribe extends Job {
    private static catch<R>(target: Object, key: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<R>>) {
        return {
            ...descriptor,
            async value(this: Subscribe) {
                if (!this.#id)
                    return console.error(`[${key} error]`, `error=${JSON.stringify('Not Subscribed')}`);
                try {
                    await Reflect.apply(descriptor.value!, this, arguments);
                } catch (error) {
                    if (error instanceof Error)
                        error = error.message;
                    console.error(`[${key} error]`, `feedId=${this.#id}`, `error=${JSON.stringify(error)}`);
                }
            }
        } as TypedPropertyDescriptor<(...args: any[]) => Promise<R | undefined>>;
    }

    static list = new Map<string, Subscribe>();
    static get(url: string) {
        let subscribe = this.list.get(url);
        if (subscribe)
            return subscribe;
        subscribe = new this(url);
        this.list.set(url, subscribe);
        return subscribe;
    }
    static async test(url: string, rewrite?: boolean) {
        const subscribe = Subscribe.get(url);
        const feed = await subscribe.test(rewrite);
        if (!subscribe.id)
            subscribe.unsubscribe();
        return feed;
    }
    static cronerIs(sub: Subscribe, group: Group) {
        for (const croner of sub.#property('croner'))
            if (croner)
                return croner === group.croner;
    }
    #url: string;
    #id?: number | null;
    #title?: string;
    #category = Category.put('Uncategorized', this) as Category;
    #groups = new Set<Group>();
    protected constructor(url: string) {
        if (!URL.canParse(url))
            throw new Error('Invalid URL');
        super();
        this.#url = url;
        Group.put(Group.global, this);
    }

    get id() {
        return this.#id;
    }
    get url() {
        return this.#url;
    }

    category(name: string) {
        if (this.#id)
            throw new Error('Initialized');
        Category.delete(this.#category, this);
        this.#category = Category.put(name, this);
        return this;
    }
    group(...names: string[]) {
        if (this.#id)
            throw new Error('Initialized');
        for (const name of names)
            this.#groups.add(Group.put(name, this));
        return this;
    }

    *#property<T extends keyof Job>(key: T): Generator<Job[T]> {
        yield super[key];
        for (const group of this.#groups)
            yield group[key];
        yield this.#category[key];
        yield Group.global[key];
    }
    #call<T extends { [K in keyof Job]: Job[K] extends (ctx: any) => Promise<any> ? K : never }[keyof Job]>(key: T, ctx: Parameters<Job[T]>[0]): Promise<Awaited<ReturnType<Job[T]>>>;
    async #call<T extends { [K in keyof Job]: Job[K] extends (ctx: any) => Promise<any> ? K : never }[keyof Job]>(key: T, ctx: any) {
        ctx = await super[key](ctx);
        for (const group of this.#groups)
            ctx = await group[key](ctx);
        ctx = await this.#category[key](ctx);
        ctx = await Group.global[key](ctx);
        return ctx;
    }

    async urlRewrite(url: string | URL) {
        return this.#call('urlRewrite', url);
    }
    get fetch() {
        for (const fetch of this.#property('fetch'))
            if (fetch)
                return fetch;
    }
    async feedRewrite(feed: Job.feed) {
        return this.#call('feedRewrite', feed);
    }
    async rewrite(item: Job.item) {
        return this.#call('rewrite', item);
    }
    get cleaner() {
        for (const cleaner of this.#property('cleaner'))
            if (cleaner)
                return cleaner;
    }

    async #fetch() {
        const url = await this.urlRewrite(this.#url);
        return await JSONFeed(await (this.fetch ?? fetch)(url));
    }

    @Subscribe.catch
    async clean() {
        const cleaner = await this.cleaner?.();
        if (!cleaner)
            return;
        const { unread, read } = cleaner;
        cleanQuery.run(this.#id!, unread?.toISOString() ?? null, read.toISOString());
    }
    @Subscribe.catch
    async update() {
        const {
            title,
            home_page_url,
            description,
            authors,
        } = await this.feedRewrite(await this.#fetch());
        updateFeedQuery.run(title, home_page_url ?? null, description ?? null, (authors && JSON.stringify(authors)) ?? null, this.#id!);
        this.#title = title;
        console.log('[update]', `feedId=${this.#id}`);
    }
    @Subscribe.catch
    async refresh() {
        const {
            title,
            home_page_url,
            description,
            authors,
            items,
        } = await this.feedRewrite(await this.#fetch());
        if (!this.#title)
            updateFeedQuery.run(title, home_page_url ?? null, description ?? null, (authors && JSON.stringify(authors)) ?? null, this.#id!);
        const cleaner = await this.cleaner?.();
        for await (const item of items)
            await this.insert(item, cleaner?.unread);
        console.log('[refresh]', `feedId=${this.#id}`);
    }
    @Subscribe.catch
    async insert(item: JSONFeed.Item, newerThan?: Date | null) {
        const { id: key, date_published } = item;
        if (newerThan && date_published && date_published <= newerThan)
            return;
        if (hasItemQuery.get(key, this.#id!))
            return;
        const {
            url,
            title,
            content_html,
            authors,
        } = await this.rewrite(item);
        insertItemQuery.get(key, url ?? null, title ?? null, content_html ?? null, date_published?.toISOString() ?? null, (authors && JSON.stringify(authors)) ?? null, this.#id!);
        console.log('[insert]', `feedId=${this.#id}`, `itemUrl=${JSON.stringify(url)}`);
    }
    async test(rewrite?: boolean) {
        const feed = await this.feedRewrite(await this.#fetch());
        if (rewrite) {
            const items = [];
            const cleaner = await this.cleaner?.();
            for await (const item of feed.items) {
                const unread = cleaner?.unread, { date_published } = item;
                if (unread && date_published && date_published <= unread)
                    items.push(await this.rewrite(item));
            }
        }
        return feed;
    }
    unsubscribe() {
        if (this.#id === null)
            return;
        if (this.#id) {
            unsubscribeQuery.run(this.#id);
        } else {
            const find = findFeedQuery.get(this.#url);
            if (find)
                unsubscribeQuery.run(find.id);
        }
        this.#id = null;
        Subscribe.list.delete(this.#url);
        for (const group of this.#groups)
            Group.delete(group, this);
        super.croner?.stop();
        this.freeze();
    }
    init(pattern?: string | Date) {
        if (this.#id === null)
            throw new Error('Is Unsubscribed');
        if (pattern)
            this.cron(pattern);
        if (this.#id)
            return this;
        this.freeze();
        const find = findFeedQuery.get(this.#url);
        const category = this.#category;
        if (find && find.category === category.name) {
            this.#id = find.id;
        } else {
            if (find) {
                updateFeedCategoryQuery.get(category.id, find.id);
                this.#id = find.id;
            } else {
                this.#id = insertFeedQuery.get(this.#url, category.id)!.id;
            }
        }
        if (!find?.title)
            this.update();
        else
            this.#title = find.title;
        subscribeQuery.run(this.#id);
        return this;
    }
    cron(pattern: string | Date) {
        super.cron(pattern);
        super.croner!.schedule(async () => {
            await this.refresh();
            await this.clean();
        });
        return this;
    }
}

namespace Factory {
    const echo = (cb: (...args: any[]) => any) => cb;
    type echo<T extends any[], R, R_1 = R | PromiseLike<R>> = <P extends [...T, ...any[]], R extends R_1>(cb: (...args: P) => R) => (...args: P) => R;
    export const urlRewriter: echo<[url: URL], void> = echo;
    export const resetFetch: echo<[url: URL], Job.fetchData> = echo;
    export const feedRewriter: echo<[feed: Job.feed], void> = echo;
    export const rewriter: echo<[item: Job.item], void> = echo;
    export const cleaner: echo<[], Job.cleanerOpts> = echo;
}

function subscribe(url: string) {
    return Subscribe.get(url);
}
namespace subscribe {
    export function test(url: string, rewrite?: boolean) {
        return Subscribe.test(url, rewrite);
    }
}

function group(name: string) {
    return Group.get(name);
}

function category(name: string) {
    return Category.get(name);
}

const global = Group.global;

plugin({
    name: 'feed-module',
    async setup(build) {
        build.module('feed:subscribe', async () => {
            return {
                exports: { subscribe, group, category, global, Factory, JSONFeed },
                loader: 'object',
            };
        });
    },
});

async function Entry(moduleIds: string[], incremental?: boolean) {
    if (!incremental)
        db.run('DELETE FROM Subscribe');

    for (const moduleId of moduleIds)
        await import(await resolve(moduleId, process.cwd()));
}

export type { Job, Subscribe, Group, Category };
export { subscribe, group, category, global, Factory, Entry, JSONFeed };
