import { Module, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { FilesModule } from '../files/files.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { GuestGuard, GuestsService } from './guests.service.js';
import { GuestReviewController, PapersController } from './papers.controller.js';
import { PapersService } from './papers.service.js';
import { PaperViews } from './papers.views.js';

@Module({
  imports: [AclModule, FilesModule, IdentityModule],
  providers: [PapersService, PaperViews, GuestsService, GuestGuard],
  controllers: [PapersController, GuestReviewController],
  exports: [PapersService],
})
export class PapersModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PaperReminders');
  private timer?: NodeJS.Timeout;

  constructor(private readonly papers: PapersService) {}

  /** PAP-12: hourly reviewer reminders (MAINTENANCE=off disables, as in tests). */
  onApplicationBootstrap() {
    if (process.env.MAINTENANCE === 'off') return;
    this.timer = setInterval(() => void this.papers.remindReviewers().catch((err) => this.logger.error({ err }, 'reminders failed')), 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
