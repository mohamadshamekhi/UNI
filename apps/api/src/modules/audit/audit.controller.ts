import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Ctx, PlatformAdmin, RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import type { RequestContext } from '../../common/context/request-context.js';
import { PageQuery } from '../../common/http/dto.js';
import { AuditService } from './audit.service.js';

class AuditQueryDto extends PageQuery {
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(50) targetType?: string;
  @IsOptional() @IsString() @MaxLength(100) targetId?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

class PlatformAuditQuery extends AuditQueryDto {
  @IsOptional() @IsUUID() tenantId?: string;
}

/** AUD-06: search the tenant's audit trail. */
@ApiTags('admin: audit')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin/audit')
export class AuditAdminController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermission('audit.view')
  @Get()
  search(@Query() q: AuditQueryDto, @Ctx() ctx: RequestContext) {
    return this.audit.search({ ...q, tenantId: ctx.tenant!.id });
  }

  @RequirePermission('audit.view')
  @Get('verify')
  async verify(@Ctx() ctx: RequestContext) {
    const broken = await this.audit.verifyChain(ctx.tenant!.id);
    return { intact: !broken, broken };
  }
}

@ApiTags('platform: audit')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('v1/platform/audit')
export class PlatformAuditController {
  constructor(private readonly audit: AuditService) {}

  /** Platform chain by default, or a tenant's chain for incident response (always audited). */
  @Get()
  async search(@Query() q: PlatformAuditQuery) {
    if (q.tenantId) {
      await this.audit.record({ action: 'audit.platform.viewed', tenantId: q.tenantId, targetType: 'tenant', targetId: q.tenantId });
      return this.audit.searchAsSystem({ ...q, tenantId: q.tenantId });
    }
    return this.audit.search({ ...q, tenantId: null });
  }

  @Get('verify')
  async verify(@Query() q: PlatformAuditQuery) {
    const broken = await this.audit.verifyChain(q.tenantId ?? null);
    return { intact: !broken, broken };
  }
}
