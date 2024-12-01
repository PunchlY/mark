import { resolve } from 'path';
import db from 'db';
import { Interval } from 'lib/timer';
import JSONFeed from './jsonfeed';

Bun.plugin({
    name: 'mark:subscribe',
    setup(build) {
        build.module('mark:subscribe', async () => {
            return {
                exports: await import('./export'),
                loader: 'object',
            };
        });
    },
});

interface Handles<P = unknown> {
    fetch(feed: JSONFeed, param: P, feedUrl: string): JSONFeed.$Input | void | PromiseLike<JSONFeed.$Input | void>;
    rewrite(item: JSONFeed.Item, param: P, feedUrl: string, homePage: string | undefined): JSONFeed.Item.$Input | void | PromiseLike<JSONFeed.Item.$Input | void>;
}
type HandleTypeName = keyof Handles;
type Handle<T extends HandleTypeName = HandleTypeName, P = unknown> = Handles<P>[T];

interface Middleware<T extends HandleTypeName> {
    name?: string;
    handle: Handle<T>;
    param?: any;
}

namespace Plugin {
    export type Options = Partial<Record<HandleTypeName, Record<string, string>>>;
}

let Helper;
class Plugin<O extends { [P in HandleTypeName]?: Partial<Record<string, string>> } = {}> {
    #middlewares: { readonly [P in HandleTypeName]: Middleware<P>[] } = { fetch: [], rewrite: [] };
    #on(type: keyof Plugin.Options, args: ArrayLike<any>): void;
    #on(type: keyof Plugin.Options, args: [handle: Handle, param: any] | [name: string, handle: Handle]) {
        if (typeof args[0] === 'function') {
            this.#middlewares[type].push({ handle: args[0] as any, param: args[1] });
        } else if (typeof args[1] === 'function') {
            const name = String(args[0]);
            this.#middlewares[type].push({ name, handle: args[1] });
        } else {
            throw new TypeError(`${args[1]} is not a function`);
        }
    }
    onFetch<T extends string>(name: T, fetch: Handle<'fetch', string>): Plugin<Omit<O, 'fetch'> & { fetch?: (O['fetch'] & {}) | Partial<Record<T, string>>; }>;
    onFetch<T>(fetch: Handle<'fetch', T>, param: T): this;
    onFetch(fetch: Handle<'fetch', undefined>): this;
    onFetch(): Plugin {
        this.#on('fetch', arguments);
        return this;
    }
    onRewrite<T extends string>(name: T, rewrite: Handle<'rewrite', string>): Plugin<Omit<O, 'rewrite'> & { rewrite?: (O['rewrite'] & {}) | Partial<Record<T, string>>; }>;
    onRewrite<T>(rewrite: Handle<'rewrite', T>, param: T): this;
    onRewrite(rewrite: Handle<'rewrite', undefined>): this;
    onRewrite(): Plugin {
        this.#on('rewrite', arguments);
        return this;
    }
    static {
        Helper = class Helper {
            options: string[] = [];
            private fetcher: Middleware<'fetch'>[];
            private rewriter: Middleware<'rewrite'>[];
            protected constructor(subscribe: Plugin) {
                this.fetcher = [...subscribe.#middlewares.fetch];
                this.rewriter = [...subscribe.#middlewares.rewrite];
                for (const [type, middlewares] of Object.entries(subscribe.#middlewares)) {
                    const names = new Set<string>();
                    for (const { name } of middlewares)
                        if (typeof name === 'string' && !names.has(name))
                            names.add(name), this.options.push(`${type}:${name}`);
                }
            }
            async fetch(feed_url: string, options?: Plugin.Options['fetch']) {
                let feed: JSONFeed = { feed_url, title: '', items: [] };
                for (const { name, handle, param } of this.fetcher) {
                    if (typeof name === 'string' && !(options && Object.hasOwn(options, name) && options[name]))
                        continue;
                    const res = await handle(feed, name ? options![name] : param, feed_url);
                    if (typeof res === 'undefined')
                        continue;
                    return await JSONFeed(res);
                }
                if (!feed.title)
                    return await JSONFeed(Bun.fetch(feed_url));
                return await JSONFeed(feed);
            }
            async rewrite(feedUrl: string, homePage: string | undefined, item: JSONFeed.Item, options?: Plugin.Options['rewrite']) {
                for (const { name, handle, param } of this.rewriter) {
                    if (typeof name === 'string' && !(options && Object.hasOwn(options, name) && options[name]))
                        continue;
                    const res = await handle(item, name ? options![name] : param, feedUrl, homePage);
                    if (typeof res === 'undefined')
                        continue;
                    return JSONFeed.Item(res);
                }
                return JSONFeed.Item(item);
            }
        };
    }
}

const cleanStmt = db.query<null, []>(`DELETE FROM Item WHERE read=1 AND star=0 AND id IN (SELECT Item.id FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id WHERE clean>0 AND unixepoch("now")-ifnull(Item.updatedAt,Item.createdAt)>=clean)`);
const readStmt = db.query<null, []>(`UPDATE Item SET read=1 WHERE read=0 AND star=0 AND id IN (SELECT Item.id FROM Item LEFT JOIN Feed ON Item.feedId=Feed.id WHERE markRead>0 AND unixepoch("now")-ifnull(Item.updatedAt,Item.createdAt)>=markRead)`);
const updateFeedStmt = db.query<{ id: number, title: string | null, homePage: string | null; }, [title: string, home_page_url: string | null, ids: string | null, id: number]>(`UPDATE Feed SET title=?,homePage=?,ids=? WHERE id=? RETURNING id,title,homePage`);
const findItemByKeyStmt = db.query<{ id: number; }, [key: string, feedId: number]>('SELECT id FROM Item WHERE key=? AND feedId=?');
const insertItemStmt = db.query<null, [key: string, url: string | null, title: string | null, contentHtml: string | null, datePublished: string | null, authors: string | null, feedId: number]>(`INSERT INTO Item (key,url,title,contentHtml,datePublished,authors,feedId) VALUES (?,?,?,?,unixepoch(?),?,?)`);
const findFeedUpdatedStmt = db.query<{ id: number, url: string, ids: string, plugins: string, refresh: number; }, []>(`SELECT id, url, plugins, ids, refresh FROM Feed WHERE refresh>0 AND (ifnull(updatedAt,1) OR refresh<=unixepoch("now")-updatedAt)`);
const findFeedFragmentStmt = db.query<{ id: number, url: string, ids: string, plugins: string; }, [id: number]>(`SELECT id, url, plugins, ids FROM Feed WHERE id=?`);

class Feed {
    declare id: number;
    declare title: string | null;
    declare url: string;
    declare homePage: string;
    declare refresh: number;
    declare markRead: number;
    declare clean: number;
    declare plugins: string;
    declare category: string;
    toJSON() {
        const { plugins, ...data } = this;
        return {
            ...data,
            plugins: JSON.parse(plugins) as Plugin.Options,
        };
    }
}

const findCategoriesStmt = db.query<{ name: string; }, []>('SELECT name FROM Category');
const findCategoryStmt = db.query<{ id: number; }, [name: string]>(`SELECT id FROM Category WHERE name=?`);
const insertCategoryStmt = db.query<{ id: number; }, [name: string]>(`INSERT INTO Category (name) VALUES (?) RETURNING id`);

const findFeedsStmt = db.query<{ id: number, title: string | null, url: string, homePage: string | null, category: string; }, []>('SELECT Feed.id, title, url, homePage, name category FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id');
const insertFeedStmt = db.query<{ id: number; }, [url: string, categoryId: number]>(`INSERT INTO Feed (url,categoryId) VALUES (?,?) RETURNING id`);
const findFeedStmt = db.query<unknown, [id: number]>('SELECT Feed.id, title, url, homePage, refresh, markRead, clean, plugins, name category FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE Feed.id=?').as(Feed);
const deleteFeedStmt = db.query<{ id: number; }, [id: number]>(`DELETE FROM Feed WHERE id=? RETURNING id`);
const updateFeedOptionsStmt = db.query<{ id: number; }, { id: number, url: string | null, categoryId: number | null, refresh: number | null, markRead: number | null, clean: number | null, plugins: string | null; }>(`UPDATE Feed SET url=ifnull($url,url),categoryId=ifnull($categoryId,categoryId),refresh=ifnull($refresh,refresh),markRead=ifnull($markRead,markRead),clean=ifnull($clean,clean),plugins=ifnull($plugins,plugins) WHERE id=$id RETURNING id`);

class Job extends Helper {
    errCountList = new Map<number, [number, number]>();
    timer = new Interval(async () => {
        cleanStmt.run();
        readStmt.run();
        for (const { id, url, ids, refresh, plugins } of findFeedUpdatedStmt.all()) {
            const errCount = this.errCountList.get(id);
            try {
                if (errCount && errCount[1]-- > 0)
                    continue;
                await this.#refresh(id, url, new Set(JSON.parse(ids)), JSON.parse(plugins));
                this.errCountList.delete(id);
            } catch (error) {
                const count = ((errCount?.[0] || 0) << 1) || 1;
                this.errCountList.set(id, [count, count * 60 > refresh ? refresh : count]);
                console.error('[refresh] %o url=%s\n%o', new Date(), url, error);
            }
        }
    }, 60 * 1000);
    async #refresh(id: number, url: string, ids: Set<string>, plugins: Plugin.Options) {
        const {
            title,
            home_page_url,
            items,
        } = await super.fetch(url, plugins.fetch);
        const newIds = [];
        for (const item of items) {
            if (!ids.has(item.id) && !findItemByKeyStmt.get(item.id, id))
                await this.#insert(id, url, item, home_page_url ?? undefined, plugins.rewrite);
            newIds.push(item.id);
        }
        return updateFeedStmt.get(title, home_page_url ?? null, JSON.stringify(newIds), id);
    }
    async #insert(feedId: number, feedUrl: string, item: JSONFeed.Item, homePage?: string, plugins?: Plugin.Options) {
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
    refresh = db.transaction(async (id: number) => {
        const feed = findFeedFragmentStmt.get(id);
        if (!feed)
            return null;
        const { url, ids, plugins } = feed;
        return await this.#refresh(id, url, new Set(JSON.parse(ids)), JSON.parse(plugins));
    });
    async testSubscribe(id: number) {
        const feedFragment = findFeedFragmentStmt.get(id);
        if (!feedFragment)
            return null;
        const { url, plugins } = feedFragment;
        return this.test(url, JSON.parse(plugins));
    }
    async test(url: string, options?: Plugin.Options) {
        const feed = await super.fetch(url, options?.fetch);
        feed.items = await Promise.all(feed.items.map((item) => super.rewrite(url, feed.home_page_url ?? undefined, item, options?.rewrite)));
        return feed;
    }
    static async entry(entrypoint?: string) {
        const subscribe = entrypoint ? (await import(resolve(process.cwd(), entrypoint))).default : new Plugin();
        return new this(subscribe);
    }

    categories() {
        return findCategoriesStmt.all();
    }
    feeds() {
        return findFeedsStmt.all();
    }
    feed(id: number) {
        return findFeedStmt.get(id)?.toJSON();
    }
    subscribe = db.transaction((url: string, category?: string) => {
        category ||= 'Uncategorized';
        const categoryId = findCategoryStmt.get(category)?.id ?? insertCategoryStmt.get(category)?.id!;
        return { ...insertFeedStmt.get(url, categoryId)!, category };
    });
    unsubscribe(id: number) {
        return deleteFeedStmt.get(id);
    }
    update = db.transaction((id: number, { category, plugins, url, refresh, markRead, clean }: { category?: string, url?: string, refresh?: number, markRead?: number, clean?: number, plugins?: Plugin.Options; }) => {
        const categoryId = typeof category === 'undefined' ?
            null :
            (category ||= 'Uncategorized', findCategoryStmt.get(category)?.id ?? insertCategoryStmt.get(category)?.id!);
        const feedId = updateFeedOptionsStmt.get({
            id,
            categoryId,
            url: url ?? null,
            refresh: refresh ?? null,
            markRead: markRead ?? null,
            clean: clean ?? null,
            plugins: typeof plugins === 'undefined' ? null : JSON.stringify(plugins),
        })?.id;
        if (!feedId)
            return;
        return { id: feedId, category };
    });
}

export { Plugin, Job };
