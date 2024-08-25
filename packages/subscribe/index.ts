import { z } from 'zod';
import { Instance } from 'lib/cache';
import { Job, Category, Factory, Feed } from './subscribe';
import JSONFeed from './jsonfeed';

const nameSchema = z.string().min(1);
function category(name?: string) {
    if (arguments.length === 0)
        name = '';
    else
        name = nameSchema.parse(name);
    return Instance(Category, name);
}

const urlSchema = z.string().url();
function subscribe(url: string) {
    url = urlSchema.parse(url);
    return Instance(Feed, url);
}

export type { Job, Category, Feed };
export { category, subscribe, Factory, JSONFeed };
