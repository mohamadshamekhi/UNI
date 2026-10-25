import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { CasesService } from './cases.service.js';
import { WorkflowEngine } from './engine.service.js';
import { CasesController, WorkflowAdminController } from './workflow.controller.js';
import { WorkflowsService } from './workflows.service.js';

@Module({
  imports: [AclModule],
  providers: [WorkflowEngine, CasesService, WorkflowsService],
  controllers: [WorkflowAdminController, CasesController],
  exports: [WorkflowEngine],
})
export class WorkflowModule {}
