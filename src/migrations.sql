-- sqlite
CREATE TABLE IF NOT EXISTS Feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    url TEXT NOT NULL CHECK (length(url) > 0),
    title TEXT CHECK (length(title) > 0),
    homePage TEXT,
    ids TEXT NOT NULL CHECK (json_valid(ids)) DEFAULT ('[]'),
    updatedAt INTEGER,
    refresh INTEGER CHECK (refresh >= 0),
    markRead INTEGER CHECK (markRead >= 0),
    clean INTEGER CHECK (clean >= 0),
    plugins TEXT NOT NULL CHECK (json_valid(plugins)),
    category TEXT NOT NULL CHECK (length(category) > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS Item (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL CHECK (length(key) > 0),
    url TEXT,
    title TEXT,
    contentHtml TEXT,
    datePublished INTEGER,
    author TEXT,
    read INTEGER NOT NULL DEFAULT(false),
    star INTEGER NOT NULL DEFAULT(false),
    createdAt INTEGER NOT NULL DEFAULT (unixepoch('now')),
    updatedAt INTEGER,
    feedId INTEGER NOT NULL,
    UNIQUE(key, feedId),
    FOREIGN KEY (feedId) REFERENCES Feed(id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TRIGGER IF NOT EXISTS UpdateFeedOnItemInsert
AFTER
INSERT
    ON Item BEGIN
UPDATE
    Feed
SET
    updatedAt = unixepoch('now')
WHERE
    id = NEW.feedId;

END;

CREATE TRIGGER IF NOT EXISTS UpdateItemStatusOnUpdateStarOrRead
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
