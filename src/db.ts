import migrations from './migrations.sql' with { type: 'file' };

const sql = new Bun.SQL({
    create: true,
    readwrite: true,
});
console.log(sql.options.adapter)
if (sql.options.adapter === 'sqlite') {
    await sql`PRAGMA foreign_keys = ON`;
    await sql`PRAGMA journal_mode = WAL`;
}
await sql.file(migrations);

export { sql };
