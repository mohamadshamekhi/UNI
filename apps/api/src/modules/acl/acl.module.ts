import { Module } from '@nestjs/common';
import { AclAdminController, MyPermissionsController } from './acl.controller.js';
import { AclService } from './acl.service.js';
import { RolesService } from './roles.service.js';

@Module({
  providers: [AclService, RolesService],
  controllers: [AclAdminController, MyPermissionsController],
  exports: [AclService, RolesService],
})
export class AclModule {}
