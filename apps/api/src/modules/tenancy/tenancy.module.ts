import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { PlatformTenantsController, TenancyPublicController, TenantAdminController } from './tenancy.controller.js';
import { TenantResolverMiddleware } from './tenant-resolver.middleware.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [AclModule],
  providers: [TenantsService, TenantResolverMiddleware],
  controllers: [PlatformTenantsController, TenantAdminController, TenancyPublicController],
  exports: [TenantsService, TenantResolverMiddleware],
})
export class TenancyModule {}
