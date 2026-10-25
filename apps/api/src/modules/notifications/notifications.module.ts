import { Module } from '@nestjs/common';
import { InboxController, NotificationAdminController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  providers: [NotificationsService],
  controllers: [InboxController, NotificationAdminController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
