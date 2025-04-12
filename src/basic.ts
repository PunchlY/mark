import { Controller, Hook } from 'router';
import { HTTPResponseError } from './error';

@Controller()
export class BasicAuth {

    @Hook('beforeHandle')
    async basicAuth({ headers }: Request) {
        if (process.env.NODE_ENV !== 'production')
            return;
        const auth = headers.get('Authorization');
        if (auth && auth.startsWith('Basic ')) {
            const [username, password] = atob(auth.slice(6)).split(':');
            console.log(username, password);
            if (username === Bun.env.EMAIL && password === Bun.env.PASSWORD)
                return;
        }
        throw new HTTPResponseError('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Basic realm="Secure Area"' } });
    }

}
