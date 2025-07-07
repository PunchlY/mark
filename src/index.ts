import { Mount, Controller, Route, Static } from 'router';
import { Refresh } from './refresh';
import { API } from './api';
import { FeedBin } from './feedbin';
import { GoogleReader } from './greader';
import html from './index.html';

@Controller()
export class Main {
    @Mount()
    readonly api!: API;
    @Mount()
    readonly feedbin!: FeedBin;
    @Mount()
    readonly greader!: GoogleReader;

    constructor(refreshService: Refresh) {
        if (process.env.NODE_ENV === 'production')
            refreshService.enableAutoRefresh();
    }

    @Static('/')
    app = html;

}
