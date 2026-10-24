import { createParamDecorator, SetMetadata } from '@nestjs/common';
import { requestContext, type RequestContext } from '../context/request-context.js';
import type { PermissionCode } from '../../modules/acl/permissions.catalog.js';

export const IS_PUBLIC = 'auth:public';
export const TENANT_SCOPE = 'tenant:scope';
export const REQUIRED_PERMISSIONS = 'acl:permissions';
export const PLATFORM_ADMIN = 'auth:platform-admin';

/** No authentication required (a valid token is still parsed when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface TenantScopeOptions {
  /**
   * 'active' — caller must hold an active membership (default)
   * 'any'    — authenticated or anonymous caller, tenant must be resolvable and usable
   */
  membership?: 'active' | 'any';
}

/** Route operates inside one tenant resolved from the X-Tenant header or host (TEN-02). */
export const TenantScoped = (opts: TenantScopeOptions = {}) =>
  SetMetadata(TENANT_SCOPE, { membership: opts.membership ?? 'active' } satisfies TenantScopeOptions);

/**
 * Caller must hold every listed permission in at least one scope. Resource-level scope checks
 * (unit, case) are done in services via AclService.assert (ACL-05).
 */
export const RequirePermission = (...codes: PermissionCode[]) => SetMetadata(REQUIRED_PERMISSIONS, codes);

export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN, true);

export const Ctx = createParamDecorator((): RequestContext => requestContext.get());
