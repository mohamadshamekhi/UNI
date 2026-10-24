import { Module } from '@nestjs/common';
import { UnitsAdminController, UnitsPublicController } from './units.controller.js';
import { UnitsService } from './units.service.js';

@Module({ providers: [UnitsService], controllers: [UnitsAdminController, UnitsPublicController], exports: [UnitsService] })
export class OrgModule {}
