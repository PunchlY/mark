import { Elysia } from "elysia";
import { openapi } from "@elysia/openapi";

const app = new Elysia()
    .use(openapi())
    .get('/', () => 'hello');

app.listen(3000);
