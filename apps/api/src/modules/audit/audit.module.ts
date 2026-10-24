import { Global, Module } from '@nestjs/common';
import { AuditAdminController, PlatformAuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({ providers: [AuditService], controllers: [AuditAdminController, PlatformAuditController], exports: [AuditService] })
export class AuditModule {}
