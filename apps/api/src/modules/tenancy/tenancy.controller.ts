import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsHexColor,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Ctx, PlatformAdmin, Public, RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import type { RequestContext } from '../../common/context/request-context.js';
import { ReasonBody } from '../../common/http/dto.js';
import type { TenantStatus } from '../../database/schema.js';
import { TenantsService } from './tenants.service.js';

class BrandingDto {
  @IsOptional() @IsUUID() logoFileId?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
}

class PasswordPolicyDto {
  @IsOptional() @IsInt() @Min(8) @Max(64) minLength?: number;
}

class NotificationSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) smsMonthlyQuota?: number;
}

class RetentionSettingsDto {
  @IsOptional() @IsInt() @Min(30) @Max(3650) membershipDocsDays?: number;
}

class MembershipSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(365) reapplyAfterDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) revisionDeadlineDays?: number;
}

/** TEN-08/09 settings a university admin may change. */
class TenantSettingsDto {
  @IsOptional() @IsIn(['jalali', 'gregorian']) calendar?: 'jalali' | 'gregorian';
  @IsOptional() @IsIn(['fa', 'en']) locale?: 'fa' | 'en';
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekendDays?: number[];
  @IsOptional() @ValidateNested() @Type(() => BrandingDto) branding?: BrandingDto;
  @IsOptional() @ValidateNested() @Type(() => PasswordPolicyDto) passwordPolicy?: PasswordPolicyDto;
  @IsOptional() @ValidateNested() @Type(() => MembershipSettingsDto) membership?: MembershipSettingsDto;
  @IsOptional() @ValidateNested() @Type(() => RetentionSettingsDto) retention?: RetentionSettingsDto;
}

/** Platform-only settings on top of the tenant ones. */
class PlatformTenantSettingsDto extends TenantSettingsDto {
  @IsOptional() @IsInt() @Min(0) storageQuotaBytes?: number;
  @IsOptional() @ValidateNested() @Type(() => NotificationSettingsDto) notifications?: NotificationSettingsDto;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

class CreateTenantBody {
  @Matches(SLUG) slug: string;
  @IsString() @IsNotEmpty() @MaxLength(200) nameFa: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @Matches(DOMAIN) domain?: string;
  @IsOptional() @ValidateNested() @Type(() => PlatformTenantSettingsDto) settings?: PlatformTenantSettingsDto;
}

class UpdateTenantBody {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) nameFa?: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @Matches(DOMAIN) domain?: string;
  @IsOptional() @ValidateNested() @Type(() => PlatformTenantSettingsDto) settings?: PlatformTenantSettingsDto;
}

class StatusBody extends ReasonBody {
  @IsIn(['active', 'suspended', 'archived']) status: TenantStatus;
}

class ModulesBody {
  @IsArray() @IsString({ each: true }) modules: string[];
}

class AdminBody {
  @IsString() @MaxLength(20) mobile: string;
  @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
}

class SearchQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

@ApiTags('platform: tenants')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('v1/platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list(@Query() q: SearchQuery) {
    return this.tenants.list(q.q);
  }

  @Post()
  create(@Body() body: CreateTenantBody) {
    return this.tenants.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }

  @Get(':id/overview')
  overview(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.overview(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTenantBody) {
    return this.tenants.update(id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: StatusBody) {
    return this.tenants.setStatus(id, body.status, body.reason);
  }

  @Put(':id/modules')
  modules(@Param('id', ParseUUIDPipe) id: string, @Body() body: ModulesBody) {
    return this.tenants.setModules(id, body.modules);
  }

  @Post(':id/admins')
  addAdmin(@Param('id', ParseUUIDPipe) id: string, @Body() body: AdminBody) {
    return this.tenants.addAdmin(id, body);
  }
}

@ApiTags('admin: tenant')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin/tenant')
export class TenantAdminController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  async current() {
    const t = await this.tenants.current();
    return { id: t.id, slug: t.slug, nameFa: t.nameFa, nameEn: t.nameEn, domain: t.domain, status: t.status, settings: t.settings, enabledModules: t.enabledModules };
  }

  @RequirePermission('tenant.settings.edit')
  @Patch('settings')
  async settings(@Body() body: TenantSettingsDto, @Ctx() ctx: RequestContext) {
    const t = await this.tenants.update(ctx.tenant!.id, { settings: body });
    return t.settings;
  }
}

@ApiTags('public')
@Controller('v1/public')
export class TenancyPublicController {
  constructor(private readonly tenants: TenantsService) {}

  /** Active organisations for the registration picker (section 6, step 1). */
  @Public()
  @Get('tenants')
  list() {
    return this.tenants.publicList();
  }

  /** Public logo (UX-10); cached by browsers, served with a locked-down content policy. */
  @Public()
  @Get('tenants/:slug/logo')
  async logo(@Param('slug') slug: string, @Res() res: Response) {
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) throw new AppError('NOT_FOUND');
    const found = await this.tenants.publicLogo(slug);
    if (!found) throw new AppError('NOT_FOUND');
    res.setHeader('Content-Type', found.file.mimeType);
    res.setHeader('Content-Length', String(found.file.sizeBytes));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('ETag', `"${found.file.sha256}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    found.stream.pipe(res);
  }

  /** Branding and locale of the tenant resolved from X-Tenant / host (UX-10). */
  @Public()
  @TenantScoped({ membership: 'any' })
  @Get('tenant')
  async current() {
    const t = await this.tenants.current();
    return {
      slug: t.slug,
      nameFa: t.nameFa,
      nameEn: t.nameEn,
      branding: t.settings.branding ?? {},
      calendar: t.settings.calendar ?? 'jalali',
      locale: t.settings.locale ?? 'fa',
      timezone: t.settings.timezone ?? 'Asia/Tehran',
      enabledModules: t.enabledModules,
    };
  }
}
