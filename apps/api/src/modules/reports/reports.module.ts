import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [AclModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
