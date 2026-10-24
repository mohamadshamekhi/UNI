import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { FilesModule } from '../files/files.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MembershipAdminController, RegistrationController } from './membership.controller.js';
import { MembershipService } from './membership.service.js';

@Module({
  imports: [AclModule, FilesModule, IdentityModule],
  providers: [MembershipService],
  controllers: [RegistrationController, MembershipAdminController],
})
export class MembershipModule {}
