import { Database, constants } from 'bun:sqlite';
import migrations from './migrations.sql' with { type: 'text' };

const db: Database = process.env.NODE_ENV === 'production' ?
    new Database(Bun.env.DATABASE || 'sqlite.db', { strict: true }) :
    // @ts-ignore
    globalThis['$sqlite'] ??= new Database(`${__dirname}/dev.db`, { strict: true });

process.once('exit', () => db.close());

db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
db.run('PRAGMA JOURNAL_MODE = WAL;');
db.run('PRAGMA FOREIGN_KEYS = ON;');

db.run(migrations);

export default db;
