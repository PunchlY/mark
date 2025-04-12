import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { Injectable } from 'router';
import { HTTPResponseError } from './error';

@Injectable()
export class JWT<T extends JWTPayload> {
    expirationTime = '3h';
    secret = new TextEncoder().encode(`${Date()} ${Math.random()}`);
    sign(data: T) {
        return new SignJWT(data)
            .setProtectedHeader({
                alg: 'HS256'
            })
            .setExpirationTime(this.expirationTime)
            .sign(this.secret);
    }
    async verify(jwt?: string) {
        if (!jwt)
            throw new HTTPResponseError('Unauthorized', { status: 401 });
        const { payload } = await jwtVerify<T>(jwt, this.secret);
        return payload;
    }
}
