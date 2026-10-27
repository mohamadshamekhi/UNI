import { Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { FilesModule } from '../files/files.module.js';
import { EventsService } from './events.service.js';
import { EventsAdminController, EventsController, NewsAdminController, NewsFeedController, NewsPublicFilesController } from './news.controller.js';
import { NewsService } from './news.service.js';

@Module({
  imports: [AclModule, FilesModule],
  providers: [NewsService, EventsService],
  controllers: [NewsFeedController, NewsPublicFilesController, NewsAdminController, EventsController, EventsAdminController],
  exports: [NewsService, EventsService],
})
export class NewsModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NewsSchedule');
  private timer?: NodeJS.Timeout;

  constructor(private readonly news: NewsService) {}

  /** NWS-07: publish scheduled posts and archive expired ones every minute (MAINTENANCE=off disables). */
  onApplicationBootstrap() {
    if (process.env.MAINTENANCE === 'off') return;
    this.timer = setInterval(() => void this.news.sweep().catch((err) => this.logger.error({ err }, 'news sweep failed')), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
