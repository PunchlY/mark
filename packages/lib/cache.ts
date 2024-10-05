
/* @__PURE__ */ const listCache = new WeakMap<Function, Map<any, any>>;

function CacheList<T extends new (key: any) => any>(constructor: T): Map<T, InstanceType<T>> {
    let list = listCache.get(constructor);
    if (!list) {
        list = new Map();
        listCache.set(constructor, list);
    }
    return list;
}

function Instance<T extends new (key: any) => InstanceType<T>>(constructor: T, key: ConstructorParameters<T>[0]) {
    const list = CacheList(constructor);
    let instance = list.get(key);
    if (!instance) {
        instance = new constructor(key);
        list.set(key, instance);
    }
    return instance;
}

function* GetCacheList<T extends new (key: any) => any>(constructor: T) {
    const list = listCache.get(constructor);
    if (!list)
        return;
    yield* list.entries() as IterableIterator<[key: ConstructorParameters<T>[0], value: InstanceType<T>]>;
}

function GetCache<T extends new (key: any) => any>(constructor: T, key: ConstructorParameters<T>[0]) {
    return listCache.get(constructor)?.get(key) as InstanceType<T> | undefined;
}

function CleanCache<T extends new (key: any) => any>(constructor: T) {
    return listCache.delete(constructor);
}

export { Instance, GetCacheList, GetCache, CleanCache };
