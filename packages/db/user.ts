
namespace User {
    export async function verify(username: string, password: string) {
        if (process.env.NODE_ENV !== 'production')
            return true;
        return Bun.env.EMAIL === username && Bun.env.PASSWORD === password;
    }
    export async function has(username: string) {
        if (process.env.NODE_ENV !== 'production')
            return true;
        return Bun.env.EMAIL === username;
    }
};

export { User };
