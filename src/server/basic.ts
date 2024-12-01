import { Elysia, InvertedStatusMap } from 'elysia';
import { User } from 'db/user';

class BasicAuthError extends Error { }

export default new Elysia({ name: 'basic-auth' })
    .error('BASIC_AUTH_ERROR', BasicAuthError)
    .onTransform({ as: 'scoped' }, async ({ request: { method, headers } }) => {
        if (process.env.NODE_ENV !== 'production')
            return;
        if (method === 'OPTIONS')
            return;
        const auth = headers.get('Authorization');
        if (auth && auth.startsWith('Basic ')) {
            const [username, password] = atob(auth.slice(6)).split(':');
            if (await User.verify(username, password))
                return;
        }
        throw new BasicAuthError();
    })
    .onError({ as: 'scoped' }, ({ code, set }) => {
        if (code === 'BASIC_AUTH_ERROR') {
            set.headers['www-authenticate'] = 'Basic';
            set.status = 401;
            return InvertedStatusMap[401];
        }
    });
