
if (process.env.NODE_ENV !== 'production') {
    // @ts-ignore
    const intervals: Set<Timer> = globalThis['$intervals'] ??= new Set();
    for (const timer of intervals)
        clearInterval(timer);
    globalThis.setInterval = new Proxy(setInterval, {
        apply(target, thisArg, argArray) {
            const timer: Timer = Reflect.apply(target, thisArg, argArray);
            intervals.add(timer);
            return timer;
        },
    });
}

class Interval<T extends any[] = []> {
    #timer?: Timer;
    #handler: Parameters<typeof setInterval>;
    constructor(handler: (...args: T) => void, interval?: number, ...args: T);
    constructor(...handler: Parameters<typeof setInterval>) {
        this.#handler = handler;
    }
    get isRun() {
        return typeof this.#timer !== 'undefined';
    }
    start() {
        this.#timer ||= setInterval.apply(undefined, this.#handler);
    }
    restart() {
        this.#timer = this.#timer?.refresh() || setInterval.apply(undefined, this.#handler);
    }
    stop() {
        clearInterval(this.#timer), this.#timer = undefined;
    }

}

export { Interval };
