import { Elysia, StatusMap } from 'elysia';

export default new Elysia({ name: 'logger' })
    .state('loggerTimeStart', 0)
    .onRequest(({ request: { method, url }, store }) => {
        store.loggerTimeStart = Bun.nanoseconds();
        console.debug('[request] %o method=%s pathname=%s', new Date(), method, new URL(url).pathname);
    })
    .onAfterResponse({ as: 'global' }, ({ request: { method }, path, set: { status }, store: { loggerTimeStart } }) => {
        console.debug('[response] %o method=%s pathname=%s status=%d time=%d', new Date(), method, path, typeof status === 'number' ? status : status && StatusMap[status], Bun.nanoseconds() - loggerTimeStart);
    })
    .onError({ as: 'global' }, ({ request: { method }, path, code, error }) => {
        switch (code) {
            case 'NOT_FOUND':
                console.error('[request] %o method=%s pathname=%s code=%s', new Date(), method, path, code);
                break;
            default:
                console.error('[request] %o method=%s pathname=%s code=%s\n%o', new Date(), method, path, code, error);
                break;
        }
    });
