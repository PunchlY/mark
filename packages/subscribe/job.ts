import { plugin } from 'bun';
import { resolve } from 'path';
import Cron from 'croner';
import { GetCacheList, Instance } from 'lib/cache';
import { Feed, Subscribe } from './subscribe';
import db from 'db';
import JSONFeed from './jsonfeed';

db.run('DELETE FROM Subscribe');
plugin({
    name: 'feed-module',
    async setup(build) {
        build.module('feed:subscribe', async () => {
            return {
                exports: await import('./index'),
                loader: 'object',
            };
        });
    },
});

class SubscribeCron extends Cron {
    refresh = new Set<SubscribeJob>();
    clean = new Set<SubscribeJob>();
    unreadClean = new Set<SubscribeJob>();
    constructor(pattern: string | Date) {
        super(pattern, { paused: true });
        // @ts-ignore
        this.schedule();
    }
    // @ts-ignore
    async fn(cron: typeof this, ctx: any) {
        for (const subscribe of this.refresh.values())
            await subscribe.refresh();
        for (const subscribe of this.clean.values())
            await subscribe.clean();
        for (const subscribe of this.unreadClean.values())
            await subscribe.unreadClean();
    }
}

const findCategoryStmt = db.query<{ id: number; }, [name: string]>(`SELECT id FROM Category WHERE name=?`);
const insertCategoryStmt = db.query<{ id: number; }, [name: string]>(`INSERT INTO Category (name) VALUES (?) RETURNING id`);

class Category {
    id: number;
    constructor(public name: string) {
        this.id = findCategoryStmt.get(name)?.id ??
            insertCategoryStmt.get(name)?.id!;
    }
}

const subscribeStmt = db.query<null, [number]>(`INSERT OR IGNORE INTO Subscribe (id) VALUES (?)`);

const findFeedStmt = db.query<{ id: number; title: string | null, category: string; }, [url: string]>(`SELECT Feed.id, Feed.title, Category.name category FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE url=?`);
const insertFeedStmt = db.query<{ id: number; }, [url: string, category: number]>(`INSERT INTO Feed (url,categoryId) VALUES (?,?) RETURNING id`);
const updateFeedCategoryStmt = db.query<null, [categoryId: number, id: number]>(`UPDATE Feed SET categoryId=? WHERE id=?`);
const updateFeedStmt = db.query<null, [title: string, home_page_url: string | null, authors: string | null, ids: string | null, id: number]>(`UPDATE Feed SET title=?,homePage=?,authors=?,ids=? WHERE id=?`);
const getFeedIdsStmt = db.query<{ ids: string; }, [feedId: number]>(`SELECT ids FROM Feed WHERE id=?`);

const insertItemStmt = db.query<null, [key: string, url: string | null, title: string | null, contentHtml: string | null, datePublished: string | null, authors: string | null, feedId: number]>(`INSERT INTO Item (key,url,title,contentHtml,datePublished,authors,feedId) VALUES (?,?,?,?,unixepoch(?),?,?)`);
const findItemStmt = db.query<{ id: number; }, [key: string, feedId: number]>('SELECT id FROM Item WHERE key=? AND feedId=?');

const cleanStmt = db.query<null, [feedId: number, read: boolean | null]>(`DELETE FROM Item WHERE feedId=? AND ifnull(read=?,1) AND star=0 AND remove=1`);
const setRemoveStmt = db.query<null, [feedId: number, read: boolean | null]>(`UPDATE Item SET remove=1 WHERE feedId=? AND ifnull(read=?,1) AND star=0`);

class SubscribeJob extends Subscribe {
    private static catch<R>(target: Object, key: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<R>>) {
        return {
            ...descriptor,
            async value(this: SubscribeJob) {
                try {
                    await Reflect.apply(descriptor.value!, this, arguments);
                } catch (error) {
                    if (error instanceof Error)
                        error = error.message;
                    console.error('[%s] feedId=%d error=%s', key, this.id, error);
                }
            }
        } as TypedPropertyDescriptor<(...args: any[]) => Promise<R | undefined>>;
    }
    id: number;
    constructor(opt: Feed.Data) {
        super(opt);
        const find = findFeedStmt.get(this.url);
        const category = Instance(Category, this.category);
        if (find) {
            this.id = find.id;
            if (find.category !== category.name)
                updateFeedCategoryStmt.run(category.id, this.id);
        } else {
            this.id = insertFeedStmt.get(this.url, category.id)!.id;
        }
        subscribeStmt.run(this.id);
        if (!find?.title)
            this.refresh();

        if (this.refresher)
            Instance(SubscribeCron, this.refresher).refresh.add(this);
        if (this.cleaner)
            Instance(SubscribeCron, this.cleaner).clean.add(this);
        if (this.unreadCleaner)
            Instance(SubscribeCron, this.unreadCleaner).unreadClean.add(this);
    }
    private ids() {
        const str = getFeedIdsStmt.get(this.id)?.ids;
        if (!str)
            return;
        const ids = JSON.parse(str);
        if (!Array.isArray(ids) || ids.length === 0)
            return;
        return new Set(ids as string[]);
    }
    @SubscribeJob.catch
    async refresh() {
        const {
            title,
            home_page_url,
            authors,
            items,
        } = await super.fetch();
        const ids = this.ids();
        updateFeedStmt.run(title, home_page_url ?? null, (authors && JSON.stringify(authors)) ?? null, JSON.stringify(items.map(({ id }) => id)), this.id);
        for (const item of ids ?
            items.filter(({ id }) => !ids.has(id)) :
            items
        ) await this.insert(item);
        console.debug('[refresh] feedId=%d', this.id);
    }
    @SubscribeJob.catch
    async insert(item: JSONFeed.Item) {
        const key = item.id, date_published = item.date_published?.toISOString() ?? null;
        if (findItemStmt.get(key, this.id))
            return;
        const {
            url,
            title,
            content_html,
            authors,
        } = await this.rewrite(item);
        insertItemStmt.get(key, url ?? null, title ?? null, content_html ?? null, date_published, (authors && JSON.stringify(authors)) ?? null, this.id);
        console.debug('[insert] feedId=%d url=%s', this.id, key);
    }
    @SubscribeJob.catch
    async clean() {
        cleanStmt.run(this.id, true);
        setRemoveStmt.run(this.id, true);
    }
    @SubscribeJob.catch
    async unreadClean() {
        cleanStmt.run(this.id, null);
        setRemoveStmt.run(this.id, null);
    }
}

const deleteFeedStmt = db.query<null, [url: string]>(`DELETE FROM Feed WHERE url=?`);
async function Entry(files: string[]) {
    for (const file of files)
        await import(resolve(process.cwd(), file));

    for (const opt of Feed) {
        if (opt.unsubscribe) {
            deleteFeedStmt.run(opt.url);
            continue;
        }
        new SubscribeJob(opt);
    }
    for (const [, cron] of GetCacheList(SubscribeCron))
        cron.resume();
}

export { Entry };
