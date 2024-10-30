import { Database, constants } from 'bun:sqlite';
import migrations from './migrations.sql' with { type: 'text' };

function getDatabase(filename: string) {
    const db = new Database(filename, { strict: true });
    db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    db.run('PRAGMA JOURNAL_MODE = WAL');
    db.run('PRAGMA FOREIGN_KEYS = ON');

    db.run(migrations);

    return db;
}

const db: Database = process.env.NODE_ENV === 'production' ?
    getDatabase(Bun.env.DATABASE || 'sqlite.db') :
    // @ts-ignore
    globalThis['$sqlite'] ??= getDatabase(Bun.env.DATABASE_DEV || ':memory:');

export default db;
export { getDatabase };
