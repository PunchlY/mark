
function isWeakKey(value: any): value is WeakKey {
    return typeof value === 'symbol' || typeof value === 'function' || (typeof value === 'object' && value !== null);
}

class WeakRefMap<K = any, V = any> extends Map<K, V | WeakRef<(V & object) | (V & symbol)>> {
    #registry = new FinalizationRegistry((key: K) => super.delete(key));

    override set(key: K, value: V) {
        const oldValue = super.get(key);
        if (oldValue instanceof WeakRef)
            this.#registry.unregister(oldValue);
        if (isWeakKey(value)) {
            const ref = new WeakRef(value);
            this.#registry.register(value, key, ref);
            return super.set(key, ref);
        }
        return super.set(key, value);
    }
    override get(key: K): V | undefined {
        let value = super.get(key);
        if (value instanceof WeakRef)
            return value.deref();
        return value;
    }
    override has(key: K) {
        let value = super.get(key);
        if (value instanceof WeakRef) {
            if (typeof value.deref() === 'undefined') {
                super.delete(key);
                return false;
            }
            return true;
        }
        return super.has(key);
    }
    override delete(key: K) {
        const value = super.get(key);
        if (value instanceof WeakRef) {
            this.#registry.unregister(value);
            super.delete(key);
            return typeof value.deref() !== 'undefined';
        }
        return super.delete(key);
    }

    override clear() {
        for (const value of super.values())
            if (value instanceof WeakRef)
                this.#registry.unregister(value);
        return super.clear();
    }

    *[Symbol.iterator](): IterableIterator<[K, V]> {
        yield* WeakRefMap.prototype.entries.call(this);
    }
    override *entries(): IterableIterator<[K, V]> {
        for (let [key, ref] of super.entries()) {
            if (ref instanceof WeakRef) {
                const value = ref.deref();
                if (typeof value !== 'undefined')
                    yield [key, value];
                continue;
            }
            yield [key, ref!];
        }
    }
    override *values(): IterableIterator<V> {
        for (let [key, ref] of super.entries()) {
            if (ref instanceof WeakRef) {
                const value = ref.deref();
                if (typeof value === 'undefined') {
                    super.delete(key);
                    continue;
                }
                yield value;
                continue;
            }
            yield ref;
        }
    }
    override forEach<T = void>(callbackfn: (this: T, value: V, key: K, map: this) => void, thisArg?: T) {
        for (const [key, value] of WeakRefMap.prototype.entries.call(this))
            Reflect.apply(callbackfn, thisArg, [value, key, this]);
    }
}

export { WeakRefMap };
