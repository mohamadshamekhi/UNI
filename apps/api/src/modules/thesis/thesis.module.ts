import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { ThesisController } from './thesis.controller.js';
import { ThesisService } from './thesis.service.js';

@Module({
  imports: [AclModule, WorkflowModule],
  providers: [ThesisService],
  controllers: [ThesisController],
})
export class ThesisModule {}
