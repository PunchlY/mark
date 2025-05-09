
class HTTPResponseError extends Error {
    declare status: number;
    declare statusText?: string;
    declare headers: Headers;
    constructor(message?: string, init?: ResponseInit) {
        super(message);
        this.status = init?.status ?? 500;
        this.statusText = init?.statusText;
        this.headers = new Headers(init?.headers);
        if (process.env.NODE_ENV !== 'production')
            Error.captureStackTrace(this, HTTPResponseError);
    }
    getResponse() {
        return new Response(this.message, this);
    }
}

export { HTTPResponseError };
