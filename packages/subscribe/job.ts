import { resolve } from 'path';
import { Feed, Subscribe } from './subscribe';
import db from 'db';
import JSONFeed from './jsonfeed';
import { backMapConstruct } from 'lib/backmap';

const findCategoryStmt = db.query<{ id: number; }, [name: string]>(`SELECT id FROM Category WHERE name=?`);
const insertCategoryStmt = db.query<{ id: number; }, [name: string]>(`INSERT INTO Category (name) VALUES (?) RETURNING id`);

const Category = backMapConstruct(new Map(), class {
    id: number;
    constructor(public name: string) {
        this.id = findCategoryStmt.get(name)?.id ??
            insertCategoryStmt.get(name)?.id!;
    }
});

const findFeedStmt = db.query<{ id: number; title: string | null, category: string; }, [url: string]>(`SELECT Feed.id, Feed.title, Category.name category FROM Feed LEFT JOIN Category ON Feed.categoryId=Category.id WHERE url=?`);
const insertFeedStmt = db.query<{ id: number; }, [url: string, category: number]>(`INSERT INTO Feed (url,categoryId) VALUES (?,?) RETURNING id`);
const updateFeedCategoryStmt = db.query<null, [categoryId: number, id: number]>(`UPDATE Feed SET categoryId=? WHERE id=?`);
const updateFeedStmt = db.query<null, [title: string, home_page_url: string | null, ids: string | null, id: number]>(`UPDATE Feed SET title=?,homePage=?,ids=? WHERE id=?`);
const getFeedIdsStmt = db.query<{ ids: string; }, [feedId: number]>(`SELECT ids FROM Feed WHERE id=?`);
const isNeedToBeUpdatedFeedStmt = db.query<{ ids: string; }, [feedId: number, s: number]>(`SELECT ids FROM Feed WHERE id=? AND ifnull(unixepoch("now")-updatedAt>=?,1)`);

const insertItemStmt = db.query<null, [key: string, url: string | null, title: string | null, contentHtml: string | null, datePublished: string | null, authors: string | null, feedId: number]>(`INSERT INTO Item (key,url,title,contentHtml,datePublished,authors,feedId) VALUES (?,?,?,?,unixepoch(?),?,?)`);
const findItemStmt = db.query<{ id: number; }, [key: string, feedId: number]>('SELECT id FROM Item WHERE key=? AND feedId=?');

const cleanStmt = db.query<null, [feedId: number, s: number]>(`DELETE FROM Item WHERE feedId=? AND read=1 AND star=0 AND unixepoch("now")-ifnull(updatedAt,createdAt)>=?`);
const readStmt = db.query<null, [feedId: number, s: number]>(`UPDATE Item SET read=1 WHERE feedId=? AND read=0 AND star=0 AND unixepoch("now")-ifnull(updatedAt,createdAt)>=?`);

class SubscribeJob extends Subscribe {
    static #list = new Map<number, SubscribeJob>();
    static timer = setInterval(async () => {
        for (const subscribe of this.#list.values()) {
            await subscribe.refresh();
            await subscribe.clean();
        }
    }, 1000 * 60);
    static add(opt: Feed.Data) {
        if (opt.unsubscribe) {
            deleteFeedStmt.run(opt.url);
            return;
        }
        const job = new this(opt);
        this.#list.set(job.id, job);
    }
    id: number;
    private constructor(opt: Feed.Data) {
        super(opt);
        const find = findFeedStmt.get(this.url);
        const category = Category(this.category);
        if (find) {
            this.id = find.id;
            if (find.category !== category.name)
                updateFeedCategoryStmt.run(category.id, this.id);
        } else {
            this.id = insertFeedStmt.get(this.url, category.id)!.id;
        }
        this.refresh();
    }
    ids() {
        const str = getFeedIdsStmt.get(this.id)?.ids;
        if (!str)
            return;
        const ids = JSON.parse(str);
        if (!Array.isArray(ids) || ids.length === 0)
            return;
        return new Set<string>(ids);
    }
    async refresh(force?: boolean) {
        try {
            if (!this.refresher)
                return;
            if (force || !isNeedToBeUpdatedFeedStmt.get(this.id, this.refresher))
                return;
            const {
                title,
                home_page_url,
                items,
            } = await super.fetch();
            const ids = this.ids();
            updateFeedStmt.run(title, home_page_url ?? null, JSON.stringify(items.map(({ id }) => id)), this.id);
            for (const item of ids ? items.filter(({ id }) => !ids.has(id)) : items)
                await this.insert(item);
            console.debug('[refresh] feedId=%d', this.id);
        } catch (error) {
            console.error('[refresh] feedId=%d error=%s', this.id, error);
        }
    }
    async insert(item: JSONFeed.Item) {
        const key = item.id, date_published = item.date_published?.toISOString() ?? null;
        try {
            if (findItemStmt.get(key, this.id))
                return;
            const {
                url,
                title,
                content_html,
                authors,
            } = await this.rewrite(item);
            insertItemStmt.get(key, url ?? null, title ?? null, content_html ?? null, date_published, (authors && JSON.stringify(authors)) ?? null, this.id);
            console.debug('[insert] feedId=%d id=%s', this.id, key);
        } catch (error) {
            console.error('[insert] feedId=%d id=%s error=%s', this.id, key, error);
        }
    }
    async clean() {
        if (this.cleaner)
            cleanStmt.run(this.id, this.cleaner);
        if (this.reader)
            readStmt.run(this.id, this.reader);
    }
}

const deleteFeedStmt = db.query<null, [url: string]>(`DELETE FROM Feed WHERE url=?`);
async function Entry(files: string[]) {
    for (const file of files)
        await import(resolve(process.cwd(), file));

    for (const opt of Feed)
        SubscribeJob.add(opt);
}

export { Entry };
