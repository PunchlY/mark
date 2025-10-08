import { Mount, Controller } from 'router';
import { Refresh } from './refresh';
import { API } from './api';
import { FeedBin } from './feedbin';

@Controller()
export class Main {
    @Mount()
    readonly api!: API;
    @Mount()
    readonly feedbin!: FeedBin;

    constructor(refreshService: Refresh) {
        if (process.env.NODE_ENV === 'production')
            refreshService.enableAutoRefresh();
    }
}
