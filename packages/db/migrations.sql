CREATE TABLE IF NOT EXISTS Category (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL UNIQUE CHECK(length(name) > 0)
);

CREATE TABLE IF NOT EXISTS Feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT CHECK(length(title) > 0),
    homePage TEXT,
    url TEXT NOT NULL CHECK(length(url) > 0),
    ids TEXT NOT NULL CHECK(json_valid(ids)) DEFAULT('[]'),
    updatedAt INTEGER,
    refresh INTEGER NOT NULL DEFAULT(0),
    markRead INTEGER NOT NULL DEFAULT(0),
    clean INTEGER NOT NULL DEFAULT(0),
    plugins TEXT NOT NULL CHECK(json_valid(plugins)) DEFAULT('{}'),
    categoryId INTEGER NOT NULL,
    FOREIGN KEY (categoryId) REFERENCES Category(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Item (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL CHECK(length(key) > 0),
    url TEXT,
    title TEXT,
    contentHtml TEXT,
    datePublished INTEGER,
    authors TEXT CHECK(json_valid(authors)),
    read INTEGER NOT NULL DEFAULT(false),
    star INTEGER NOT NULL DEFAULT(false),
    createdAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    updatedAt INTEGER,
    feedId INTEGER NOT NULL,
    UNIQUE(key, feedId),
    FOREIGN KEY (feedId) REFERENCES Feed(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS FeedStatus
AFTER
UPDATE
    OF ids ON Feed BEGIN
UPDATE
    Feed
SET
    updatedAt = unixepoch('now')
WHERE
    rowid = NEW.ROWID;

END;

CREATE TRIGGER IF NOT EXISTS ItemStatus
AFTER
UPDATE
    OF read,
    star ON Item BEGIN
UPDATE
    Item
SET
    updatedAt = unixepoch('now')
WHERE
    rowid = OLD.rowid;

END;
