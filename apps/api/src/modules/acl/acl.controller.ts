import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDate, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ReasonBody } from '../../common/http/dto.js';
import type { ScopeType } from '../../database/schema.js';
import { AclService } from './acl.service.js';
import { PERMISSIONS, TENANT_PERMISSIONS } from './permissions.catalog.js';
import { RolesService } from './roles.service.js';

class RoleBody {
  @Matches(/^[a-z0-9_]{2,60}$/) key: string;
  @IsString() @IsNotEmpty() @MaxLength(100) nameFa: string;
  @IsOptional() @IsString() @MaxLength(100) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions: string[];
}

class RolePatchBody {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) nameFa?: string;
  @IsOptional() @IsString() @MaxLength(100) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) permissions?: string[];
}

class CopyBody {
  @Matches(/^[a-z0-9_]{2,60}$/) key: string;
  @IsString() @IsNotEmpty() @MaxLength(100) nameFa: string;
}

class AssignmentBody {
  @IsUUID() membershipId: string;
  @IsUUID() roleId: string;
  @IsIn(['tenant', 'unit', 'unit_tree', 'case']) scopeType: ScopeType;
  @ValidateIf((o: AssignmentBody) => o.scopeType !== 'tenant') @IsUUID() scopeId?: string;
  @IsOptional() @Type(() => Date) @IsDate() validFrom?: Date;
  @IsOptional() @Type(() => Date) @IsDate() validTo?: Date;
}

@ApiTags('admin: roles')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin')
export class AclAdminController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('role.manage')
  @Get('permissions')
  catalog() {
    return TENANT_PERMISSIONS.map((code) => ({ code, ...PERMISSIONS[code] }));
  }

  @RequirePermission('role.manage')
  @Get('roles')
  list() {
    return this.roles.list();
  }

  @RequirePermission('role.manage')
  @Post('roles')
  create(@Body() body: RoleBody) {
    return this.roles.create(body);
  }

  @RequirePermission('role.manage')
  @Get('roles/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @RequirePermission('role.manage')
  @Patch('roles/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: RolePatchBody) {
    return this.roles.update(id, body);
  }

  @RequirePermission('role.manage')
  @Post('roles/:id/copy')
  copy(@Param('id', ParseUUIDPipe) id: string, @Body() body: CopyBody) {
    return this.roles.copy(id, body.key, body.nameFa);
  }

  /** ACL-12: show how many members a change would affect before saving. */
  @RequirePermission('role.manage')
  @Get('roles/:id/impact')
  impact(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.impact(id);
  }

  @RequirePermission('role.manage')
  @Post('roles/:id/archive')
  @HttpCode(204)
  async archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    await this.roles.archive(id, body.reason);
  }

  @RequirePermission('role.manage')
  @Get('memberships/:id/roles')
  assignments(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.listAssignments(id);
  }

  @RequirePermission('role.manage')
  @Post('role-assignments')
  assign(@Body() body: AssignmentBody) {
    return this.roles.assign(body);
  }

  @RequirePermission('role.manage')
  @Post('role-assignments/:id/revoke')
  @HttpCode(200)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.roles.revokeAssignment(id, body.reason);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/me')
export class MyPermissionsController {
  constructor(private readonly acl: AclService) {}

  /** Effective permissions in the current tenant; clients build menus from this (section 16). */
  @Get('permissions')
  permissions() {
    return this.acl.summary();
  }
}
