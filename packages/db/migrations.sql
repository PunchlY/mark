CREATE TABLE IF NOT EXISTS Category (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL UNIQUE CHECK(length(name) > 0),
    createdAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    updatedAt INTEGER NOT NULL DEFAULT(unixepoch('now'))
);

CREATE TRIGGER IF NOT EXISTS CategoryUpdatedAt
AFTER
UPDATE
    ON Category BEGIN
UPDATE
    Category
SET
    updatedAt = unixepoch('now')
WHERE
    rowid = NEW.rowid;

END;

CREATE TABLE IF NOT EXISTS Feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT CHECK(length(title) > 0),
    homePage TEXT,
    url TEXT NOT NULL UNIQUE CHECK(length(url) > 0),
    description TEXT,
    authors TEXT,
    createdAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    updatedAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    categoryId INTEGER NOT NULL,
    FOREIGN KEY (categoryId) REFERENCES Category(id) ON UPDATE cascade ON DELETE restrict
);

CREATE TRIGGER IF NOT EXISTS FeedUpdatedAt
AFTER
UPDATE
    ON Feed BEGIN
UPDATE
    Feed
SET
    updatedAt = unixepoch('now')
WHERE
    rowid = NEW.rowid;

END;

CREATE TABLE IF NOT EXISTS Item (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL CHECK(length(key) > 0),
    url TEXT,
    title TEXT,
    contentHtml TEXT,
    datePublished INTEGER,
    authors TEXT,
    read INTEGER NOT NULL DEFAULT(false),
    star INTEGER NOT NULL DEFAULT(false),
    createdAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    updatedAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    feedId INTEGER NOT NULL,
    UNIQUE(key, feedId),
    FOREIGN KEY (feedId) REFERENCES Feed(id) ON UPDATE cascade ON DELETE restrict
);

CREATE TRIGGER IF NOT EXISTS ItemUpdatedAt
AFTER
UPDATE
    ON Item BEGIN
UPDATE
    Item
SET
    updatedAt = unixepoch('now')
WHERE
    rowid = NEW.rowid;

END;

CREATE TABLE IF NOT EXISTS Subscribe (
    id INTEGER PRIMARY KEY NOT NULL,
    FOREIGN KEY (id) REFERENCES Feed(id) ON UPDATE cascade ON DELETE restrict
);

CREATE TABLE IF NOT EXISTS CleanedItem (
    id INTEGER PRIMARY KEY NOT NULL,
    key TEXT NOT NULL CHECK(length(key) > 0),
    feedId INTEGER NOT NULL,
    UNIQUE(key, feedId),
    FOREIGN KEY (feedId) REFERENCES Feed(id) ON UPDATE cascade ON DELETE restrict
);

CREATE TRIGGER IF NOT EXISTS ItemDelete
AFTER
    DELETE ON Item BEGIN
INSERT INTO
    CleanedItem (key, feedId)
VALUES
    (OLD.key, OLD.feedId);

END;

CREATE VIEW IF NOT EXISTS CategoryView AS
SELECT
    Category.id,
    Category.name
FROM
    Category;

CREATE VIEW IF NOT EXISTS FeedView AS
SELECT
    Feed.id,
    Feed.title,
    Feed.url,
    Feed.homePage,
    Feed.description,
    Category.id categoryId,
    Category.name category
FROM
    Feed
    LEFT JOIN Category ON Feed.categoryId = Category.id
WHERE
    Feed.id IN (
        SELECT
            id
        FROM
            Subscribe
    )
    AND Feed.title IS NOT NULL;

CREATE VIEW IF NOT EXISTS ItemView AS
SELECT
    Item.id,
    Item.url,
    Item.title,
    ifnull(Item.authors, Feed.authors) authors,
    Item.contentHtml,
    ifnull(Item.datePublished, Item.createdAt) publishedAt,
    Item.createdAt,
    Item.updatedAt,
    Item.read,
    Item.star,
    Feed.id feedId,
    Feed.title feedTitle,
    Feed.url feedUrl,
    Feed.homePage,
    Feed.description,
    Category.id categoryId,
    Category.name category
FROM
    Item
    LEFT JOIN Feed ON Item.feedId = Feed.id
    LEFT JOIN Category ON Feed.categoryId = Category.id
WHERE
    Feed.id IN (
        SELECT
            id
        FROM
            Subscribe
    )
    AND Feed.title IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS ItemViewStatus INSTEAD OF
UPDATE
    OF read,
    star ON ItemView BEGIN
UPDATE
    Item
SET
    read = ifnull(NEW.read, read),
    star = ifnull(NEW.star, star)
WHERE
    id = NEW.id;

END;
