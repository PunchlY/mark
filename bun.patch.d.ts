
interface PromiseConstructor {
    try<P extends any[], R>(func: (...args: P) => R, ...args: P): Promise<Awaited<R>>;
    try(func: Function, ...args: any[]): Promise<any>;
}

declare module "bun:sqlite" {
    export interface Database {
        transaction<T extends (...args: any) => any>(insideTransaction: T): T & {
            deferred: T;
            immediate: T;
            exclusive: T;
        };
    }
}
