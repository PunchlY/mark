import { Mount, Controller, Route } from 'router';
import { Refresh } from './refresh';
import { API } from './api';
import { FeedBin } from './feedbin';
import { GoogleReader } from './greader';
import html from './index.html';

@Mount('/api', API)
@Mount('/feedbin', FeedBin)
@Mount('/greader', GoogleReader)
@Controller()
export class Main {

    constructor(refreshService: Refresh) {
        if (process.env.NODE_ENV === 'production')
            refreshService.enableAutoRefresh();
    }

    @Mount('/')
    app = html;

}
