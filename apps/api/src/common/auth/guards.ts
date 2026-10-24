import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DbService } from '../../database/db.service.js';
import { memberships, platformAdmins, users } from '../../database/schema.js';
import { AclService } from '../../modules/acl/acl.service.js';
import type { PermissionCode } from '../../modules/acl/permissions.catalog.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import { TokensService } from '../../modules/identity/tokens.service.js';
import { requestContext } from '../context/request-context.js';
import { AppError } from '../errors/app-error.js';
import {
  IS_PUBLIC,
  PLATFORM_ADMIN,
  REQUIRED_PERMISSIONS,
  TENANT_SCOPE,
  type TenantScopeOptions,
} from './decorators.js';

function meta<T>(reflector: Reflector, key: string, context: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
}

/** Step 1 of the access path: identity and session validity. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = meta<boolean>(this.reflector, IS_PUBLIC, context);
    const header = context.switchToHttp().getRequest<Request>().header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      if (isPublic) return true;
      throw new AppError('UNAUTHENTICATED');
    }

    const claims = this.tokens.verifyAccess(token);
    if (await this.tokens.isRevoked(claims.sid)) throw new AppError('SESSION_EXPIRED');
    const [user] = await this.db.sys
      .select({ status: users.status, admin: platformAdmins.userId })
      .from(users)
      .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
      .where(eq(users.id, claims.sub));
    if (!user || user.status !== 'active') throw new AppError('UNAUTHENTICATED');

    const ctx = requestContext.get();
    ctx.userId = claims.sub;
    ctx.sessionId = claims.sid;
    ctx.isPlatformAdmin = !!user.admin;
    return true;
  }
}

/** Step 2: tenant status and membership (TEN-03, tenant lifecycle in section 4). */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = meta<TenantScopeOptions>(this.reflector, TENANT_SCOPE, context);
    if (!scope) return true;
    const ctx = requestContext.get();
    const method = context.switchToHttp().getRequest<Request>().method;
    const tenant = ctx.tenant;
    if (!tenant) throw new AppError(ctx.tenantRequested ? 'TENANT_NOT_FOUND' : 'TENANT_REQUIRED');

    if (ctx.userId) {
      const [m] = await this.db.run((tx) =>
        tx
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, ctx.userId!)))
          .limit(1),
      );
      ctx.membershipId = m?.id;
      ctx.membershipStatus = m?.status;
    }
    const activeMember = ctx.membershipStatus === 'active';

    switch (tenant.status) {
      case 'suspended':
        throw new AppError('TENANT_UNAVAILABLE', { status: tenant.status });
      case 'archived':
        if (method !== 'GET' && method !== 'HEAD') throw new AppError('TENANT_UNAVAILABLE', { status: tenant.status });
        break;
      case 'draft':
        // only the introduced admin (an active member) and platform admins while configuring
        if (!activeMember && !ctx.isPlatformAdmin) throw new AppError('TENANT_UNAVAILABLE', { status: tenant.status });
        break;
    }

    if (scope.membership === 'active') {
      if (!ctx.userId) throw new AppError('UNAUTHENTICATED');
      if (!activeMember) throw new AppError('MEMBERSHIP_REQUIRED');
    }
    return true;
  }
}

/** Steps 3–6 at route level; resource scope checks happen in services. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly acl: AclService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = requestContext.get();
    if (meta<boolean>(this.reflector, PLATFORM_ADMIN, context)) {
      if (!ctx.userId) throw new AppError('UNAUTHENTICATED');
      if (!ctx.isPlatformAdmin) {
        await this.audit.recordDetached({ action: 'acl.denied', result: 'denied', tenantId: null, after: { platformAdmin: true } });
        throw new AppError('FORBIDDEN');
      }
    }
    const required = meta<PermissionCode[]>(this.reflector, REQUIRED_PERMISSIONS, context);
    if (!required?.length) return true;
    for (const code of required) {
      if (!(await this.acl.hasAnywhere(code))) {
        await this.audit.recordDetached({ action: 'acl.denied', result: 'denied', after: { permission: code } });
        throw new AppError('FORBIDDEN', { permission: code });
      }
    }
    return true;
  }
}
