import { Controller, Hook } from 'router';

@Controller()
export class BasicAuth {

    @Hook('request')
    async basicAuth({ headers }: Request) {
        if (process.env.NODE_ENV !== 'production')
            return;
        const auth = headers.get('Authorization');
        if (auth && auth.startsWith('Basic ')) {
            const [username, password] = atob(auth.slice(6)).split(':');
            if (username === Bun.env.EMAIL && password === Bun.env.PASSWORD)
                return;
        }
        return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Basic realm="Secure Area"' } });
    }

}
