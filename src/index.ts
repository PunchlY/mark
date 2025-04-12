import { Mount, Controller } from 'router';
import { API, Refresh } from './api';
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
            refreshService.beginAutoRefresh();
    }

    @Mount('/')
    app = html;

}
