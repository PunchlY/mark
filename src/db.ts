import { Database, constants } from 'bun:sqlite';
import type { SQLQueryBindings, Statement } from 'bun:sqlite';
import migrations from './migrations.sql' with { type: 'text' };

let db: Database;
function setup() {
    if (db)
        return;
    db = new Database(Bun.env.DATABASE || 'sqlite.db', { strict: true });
    db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    db.run('PRAGMA JOURNAL_MODE = WAL');
    db.run('PRAGMA FOREIGN_KEYS = ON');

    db.run(migrations);
}

// https://github.com/blakeembrey/sql-template-tag
class SQL {
    #strings: string[];
    #params: any[];
    constructor(rawStrings: readonly string[], rawValues: (SQLQueryBindings | SQL)[]) {
        setup();

        if (rawStrings.length - 1 !== rawValues.length) {
            if (rawStrings.length === 0) {
                throw new TypeError('Expected at least 1 string');
            }
            throw new TypeError(`Expected ${rawStrings.length} strings to have ${rawStrings.length - 1} values`);
        }
        const valuesLength = rawValues.reduce((len: number, value) => len + (value instanceof SQL ? value.#params.length : 1), 0);
        this.#params = new Array(valuesLength);
        this.#strings = new Array(valuesLength + 1);
        this.#strings[0] = rawStrings[0];
        // Iterate over raw values, strings, and children. The value is always
        // positioned between two strings, e.g. `index + 1`.
        let i = 0, pos = 0;
        while (i < rawValues.length) {
            const child = rawValues[i++];
            const rawString = rawStrings[i];
            // Check for nested `sql` queries.
            if (child instanceof SQL) {
                // Append child prefix text to current string.
                this.#strings[pos] += child.#strings[0];
                let childIndex = 0;
                while (childIndex < child.#params.length) {
                    this.#params[pos++] = child.#params[childIndex++];
                    this.#strings[pos] = child.#strings[childIndex];
                }
                // Append raw string to current string.
                this.#strings[pos] += rawString;
            }
            else {
                this.#params[pos++] = child;
                this.#strings[pos] = rawString;
            }
        }
    }

    prepare<ReturnType>(Class?: new () => ReturnType): Statement<ReturnType, []> {
        if (typeof Class === 'function')
            return db.prepare(this.#strings.join('?'), this.#params).as(Class);
        else
            return db.prepare(this.#strings.join('?'), this.#params);
    }
    query<ReturnType>(Class?: new () => ReturnType): Statement<ReturnType, SQLQueryBindings[]> {
        if (typeof Class === 'function')
            return db.query(this.#strings.join('?')).as(Class);
        else
            return db.query(this.#strings.join('?'));
    }

    *iterate<ReturnType>(Class?: new () => ReturnType) {
        yield* this.query(Class).iterate(...this.#params);
    }

    get<ReturnType>(Class?: new () => ReturnType): ReturnType | null {
        return this.query(Class).get(...this.#params);
    }

    all<ReturnType>(Class?: new () => ReturnType): ReturnType[] {
        return this.query(Class).all(...this.#params);
    }

    run() {
        return this.query().run(...this.#params);
    }
}

function sql(strings: TemplateStringsArray, ...values: (SQLQueryBindings | SQL)[]) {
    return new SQL(strings, values);
}
const empty = sql``;

function join(values: (SQLQueryBindings | SQL)[], separator = ',', prefix = '', suffix = '') {
    values = values.filter((value) => value !== empty);
    if (values.length === 0)
        return empty;
    return new SQL([prefix, ...Array(values.length - 1).fill(separator), suffix], values);
}

export { sql, empty, join,db };
export type { SQL };
