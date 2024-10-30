
interface MapLike<K, V> {
    has(key: K): boolean;
    set(key: K, value: V): any;
    get(key: K): V | undefined;
}
interface AsyncMapLike<K, V> {
    has(key: K): PromiseLike<boolean> | boolean;
    set(key: K, value: Awaited<V>): any;
    get(key: K): PromiseLike<Awaited<V> | undefined> | Awaited<V> | undefined;
}
type Key<T> = T extends {
    set(key: infer K, value: any): void;
} ? K : never;
type Value<T> = T extends {
    set(key: any, value: infer V): void;
} ? V : never;

function backMap<T extends MapLike<any, any>, C extends (key: Key<T>, ...args: any[]) => Value<T>>(map: T, cb: C) {
    return function (key) {
        if (map.has(key)) return map.get(key);
        const value = Reflect.apply(cb, this, arguments);
        map.set(key, value);
        return value;
    } as C extends (this: infer T, ...args: infer P) => infer R ? (this: T, ...args: P) => R : never;
}

function backMapConstruct<T extends MapLike<any, any>, C extends new (key: Key<T>, ...args: any[]) => Value<T>>(map: T, target: C) {
    return function (key) {
        if (map.has(key)) return map.get(key);
        const value = Reflect.construct(target, arguments, this || target);
        map.set(key, value);
        return value;
    } as C extends new (...args: infer P) => infer R ? { (this: (new (...args: any) => any) | undefined, ...args: P): R, (...args: P): R; } : never;
}

function backMapAsync<T extends AsyncMapLike<any, any>, C extends (key: Key<T>, ...args: any[]) => Value<T> | PromiseLike<Value<T>>>(map: T, cb: C) {
    return async function (key) {
        if (await map.has(key)) return await map.get(key);
        const value = await Reflect.apply(cb, this, arguments);
        await map.set(key, value);
        return value;
    } as C extends (this: infer T, ...args: infer P) => infer R ? (this: T, ...args: P) => Promise<Awaited<R>> : never;
}

export { backMap, backMapConstruct, backMapAsync };
export type { MapLike, AsyncMapLike };
