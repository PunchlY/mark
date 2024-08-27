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
const updateFeedStmt = db.query<null, [title: string, home_page_url: string | null, description: string | null, authors: string | null, id: number]>(`UPDATE Feed SET title=?,homePage=?,description=?,authors=? WHERE id=?`);

const insertItemStmt = db.query<null, [key: string, url: string | null, title: string | null, contentHtml: string | null, datePublished: string | null, authors: string | null, feedId: number]>(`INSERT INTO Item (key,url,title,contentHtml,datePublished,authors,feedId) VALUES (?,?,?,?,unixepoch(?),?,?)`);
const findItemStmt = db.query<{ id: number; }, [key: string, feedId: number]>('SELECT id FROM Item WHERE key=? AND feedId=?');
const updateItemStmt = db.query<null, [id: number]>(`UPDATE Item SET id=id WHERE id=?`);
const selectMinUnReadItemPublishedStmt = db.query<{ date: number; }, [feedId: number]>('SELECT MIN(datePublished) date FROM Item WHERE feedId=? AND read=0');

const cleanStmt = db.query<null, [id: number]>(`DELETE FROM Item WHERE feedid=? AND star=0 AND read=1 AND id<(SELECT MIN(Item.id) FROM Item JOIN Feed ON Item.feedId=Feed.id WHERE Feed.id=?1 AND Item.updatedAt>=Feed.updatedAt)`);
const unreadCleanStmt = db.query<null, [id: number]>(`DELETE FROM Item WHERE feedid=?1 AND star=0 AND id<(SELECT MIN(Item.id) FROM Item JOIN Feed ON Item.feedId=Feed.id WHERE Feed.id=?1 AND Item.updatedAt>=Feed.updatedAt)`);

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
        if (find && find.category === category.name) {
            this.id = find.id;
        } else {
            if (find) {
                updateFeedCategoryStmt.get(category.id, find.id);
                this.id = find.id;
            } else {
                this.id = insertFeedStmt.get(this.url, category.id)!.id;
            }
        }
        subscribeStmt.run(this.id);
        if (!find?.title)
            this.refresh();

        if (this.refresher)
            Instance(SubscribeCron, this.refresher)
                .refresh.add(this);
        if (this.cleaner)
            Instance(SubscribeCron, this.cleaner)
                .clean.add(this);
        if (this.unreadCleaner)
            Instance(SubscribeCron, this.unreadCleaner)
                .unreadClean.add(this);
    }
    minPublishedAt?: number;
    findAndUpdateItem(key: string, date_published?: Date | null) {
        const item = findItemStmt.get(key, this.id);
        if (!item)
            return false;
        if (date_published && this.minPublishedAt !== undefined && date_published.getTime() / 1000 >= this.minPublishedAt)
            updateItemStmt.run(item.id);
        return true;
    }
    @SubscribeJob.catch
    async refresh() {
        const {
            title,
            home_page_url,
            description,
            authors,
            items,
        } = await super.fetch();
        updateFeedStmt.run(title, home_page_url ?? null, description ?? null, (authors && JSON.stringify(authors)) ?? null, this.id);
        this.minPublishedAt = selectMinUnReadItemPublishedStmt.get(this.id)?.date;
        for (const item of items)
            await this.insert(item);
        console.debug('[refresh] feedId=%d', this.id);
    }
    @SubscribeJob.catch
    async insert(item: JSONFeed.Item) {
        const { id: key, date_published } = item!;
        if (this.findAndUpdateItem(key, date_published))
            return;
        const {
            url,
            title,
            content_html,
            authors,
        } = await this.rewrite(item);
        insertItemStmt.get(key, url ?? null, title ?? null, content_html ?? null, date_published?.toISOString() ?? null, (authors && JSON.stringify(authors)) ?? null, this.id);
        console.debug('[insert] feedId=%d url=%s', this.id, url);
    }
    @SubscribeJob.catch
    async clean() {
        cleanStmt.run(this.id);
    }
    @SubscribeJob.catch
    async unreadClean() {
        unreadCleanStmt.run(this.id);
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
