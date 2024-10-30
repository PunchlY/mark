
const urlRegExp = /* @__PURE__ */ new class extends Array {
    declare url: URL;
    [Symbol.replace] = RegExp.prototype[Symbol.replace];
    index = 0;
    groups = Object.freeze(Object.create(null, Object.assign(
        { url: { get: () => this.url } },
        ...(['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'] as const).map((key) => ({
            [key]: { get: () => this.url[key] },
            [`${key}_encode`]: { get: () => encodeURIComponent(this.url[key]) },
            [`${key}_decode`]: { get: () => decodeURIComponent(this.url[key]) },
        })),
    ))) as Readonly<Pick<URL, 'href' | 'origin' | 'protocol' | 'username' | 'password' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash'> & Record<`${'href' | 'origin' | 'protocol' | 'username' | 'password' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash'}${'_encode' | '_decode'}`, string>>;
    get [0]() {
        return this.url.href;
    }
    get input() {
        return this.url.href;
    }
    exec(): RegExpExecArray {
        return this;
    }
    replace(url: URL, replacement: any) {
        this.url = url;
        return this.url.href.replace(this, replacement);
    }
};

function urlReplace(url: string | URL, replacement: string): string;
function urlReplace(url: string | URL, replacement: (href: string, index: 0, string: string, groups: typeof urlRegExp.groups) => string): string;
function urlReplace(url: string | URL, replacement: any) {
    return urlRegExp.replace(url instanceof URL ? url : new URL(url), replacement);
}

export { urlReplace };
