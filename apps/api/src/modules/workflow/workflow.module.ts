import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { FilesModule } from '../files/files.module.js';
import { CalendarService } from './calendar.service.js';
import { CasesService } from './cases.service.js';
import { HolidaysController, PlatformHolidaysController } from './holidays.controller.js';
import { WorkflowEngine } from './engine.service.js';
import { CasesController, WorkflowAdminController } from './workflow.controller.js';
import { SlaService } from './sla.service.js';
import { WorkflowsService } from './workflows.service.js';

@Module({
  imports: [AclModule, FilesModule],
  providers: [WorkflowEngine, CasesService, WorkflowsService, CalendarService, SlaService],
  controllers: [WorkflowAdminController, CasesController, HolidaysController, PlatformHolidaysController],
  exports: [WorkflowEngine, SlaService, CasesService],
})
export class WorkflowModule {}
