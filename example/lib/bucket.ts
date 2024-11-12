
interface MapLike<K, V> {
    has(key: K): boolean;
    set(key: K, value: V): any;
    get(key: K): V | undefined;
}
type Key<T> = T extends {
    set(key: infer K, value: any): void;
} ? K : never;
type Value<T> = T extends {
    set(key: any, value: infer V): void;
} ? V : never;

function bucket<T extends MapLike<any, any>, C extends (key: Key<T>, ...args: any[]) => Value<T>>(map: T, cb: C) {
    return function (key) {
        if (map.has(key)) return map.get(key);
        const value = Reflect.apply(cb, this, arguments);
        map.set(key, value);
        return value;
    } as C extends (this: infer T, ...args: infer P) => infer R ? (this: T, ...args: P) => R : never;
}

function instanceBucket<T extends MapLike<any, any>, C extends new (key: Key<T>, ...args: any[]) => Value<T>>(map: T, constructor: C) {
    return function (key) {
        if (map.has(key)) return map.get(key);
        const value = Reflect.construct(constructor, arguments, this || constructor);
        map.set(key, value);
        return value;
    } as C extends new (...args: infer P) => infer R ? { (this: (new (...args: any) => any) | undefined, ...args: P): R, (...args: P): R; } : never;
}

export { bucket, instanceBucket };
export type { MapLike };
