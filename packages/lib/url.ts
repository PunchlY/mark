
const urlKeys = /* @__PURE__ */['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'] as const;
type urlKeys = typeof urlKeys[number];
let url: URL | null = null;
const urlRegExp = /* @__PURE__ */  {
    [Symbol.replace]: RegExp.prototype[Symbol.replace],
    index: 0,
    length: 1,
    groups: Object.preventExtensions(Object.create(null, Object.assign(...urlKeys.map((key) => ({
        [key]: { get: () => url![key] },
        [`${key}_encode`]: { get: () => encodeURIComponent(url![key]) },
        [`${key}_decode`]: { get: () => decodeURIComponent(url![key]) },
    })) as [object, ...any[]]))),
    get [0]() {
        return url!.href;
    },
    get input() {
        return url!.href;
    },
    exec() {
        return this;
    },
};

function urlReplace(url: string | URL, replacement: string): string;
function urlReplace(url: string | URL, replacement: (href: string, index: 0, string: string, groups: Readonly<Pick<URL, urlKeys> & Record<`${urlKeys}${'_encode' | '_decode'}`, string>>) => string): string;
function urlReplace(value: string | URL, replacement: any) {
    return (url = value instanceof URL ? value : new URL(value)).href.replace(urlRegExp, replacement);
}

export { urlReplace };
