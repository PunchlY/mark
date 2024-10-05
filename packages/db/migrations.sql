CREATE TABLE IF NOT EXISTS Category (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL UNIQUE CHECK(length(name) > 0)
);

CREATE TABLE IF NOT EXISTS Feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT CHECK(length(title) > 0),
    homePage TEXT,
    url TEXT NOT NULL UNIQUE CHECK(length(url) > 0),
    ids TEXT,
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
    authors TEXT,
    read INTEGER NOT NULL DEFAULT(false),
    star INTEGER NOT NULL DEFAULT(false),
    age INTEGER NOT NULL DEFAULT(0) CHECK(age >= 0),
    createdAt INTEGER NOT NULL DEFAULT(unixepoch('now')),
    feedId INTEGER NOT NULL,
    UNIQUE(key, feedId),
    FOREIGN KEY (feedId) REFERENCES Feed(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS ItemStatus
AFTER
UPDATE
    OF read,
    star ON Item BEGIN
UPDATE
    Item
SET
    age = 0
WHERE
    NEW.read = false
    OR NEW.star = true;

END;

CREATE TABLE IF NOT EXISTS Subscribe (
    id INTEGER PRIMARY KEY NOT NULL,
    FOREIGN KEY (id) REFERENCES Feed(id) ON UPDATE CASCADE ON DELETE CASCADE
);

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
    Item.authors,
    Item.contentHtml,
    ifnull(Item.datePublished, Item.createdAt) publishedAt,
    Item.createdAt,
    Item.read,
    Item.star,
    Feed.id feedId,
    Feed.title feedTitle,
    Feed.url feedUrl,
    Feed.homePage,
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
