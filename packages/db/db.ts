import { Database, constants } from 'bun:sqlite';
import migrations from './migrations.sql' with { type: 'text' };

function GetDatabase(filename: string) {
    const db = new Database(filename, { strict: true });
    db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    db.run('PRAGMA JOURNAL_MODE = WAL;');
    db.run('PRAGMA FOREIGN_KEYS = ON;');

    db.run(migrations);

    return db;
}

const db: Database = process.env.NODE_ENV === 'production' ?
    GetDatabase(Bun.env.DATABASE || 'sqlite.db') :
    // @ts-ignore
    globalThis['$sqlite'] ??= GetDatabase(`${__dirname}/dev.db`);

db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
db.run('PRAGMA JOURNAL_MODE = WAL;');
db.run('PRAGMA FOREIGN_KEYS = ON;');

db.run(migrations);

export default db;
export { GetDatabase };
