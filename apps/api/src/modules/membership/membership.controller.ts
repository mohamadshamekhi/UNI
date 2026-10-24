import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppError } from '../../common/errors/app-error.js';
import { IMPORT_MAX_BYTES } from './import.js';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Public, RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { PageQuery, ReasonBody } from '../../common/http/dto.js';
import type { MembershipKind, MembershipStatus } from '../../database/schema.js';
import { MembershipService, REVISABLE_FIELDS, type RevisableField } from './membership.service.js';

const KINDS = ['student', 'faculty', 'staff'] as const;
const STATUSES: MembershipStatus[] = ['draft', 'pending_review', 'needs_revision', 'active', 'rejected', 'suspended', 'ended'];

class ApplicationBody {
  @IsIn(KINDS) kind: (typeof KINDS)[number];
  @IsUUID() unitId: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) extraUnitIds?: string[];
  @IsString() @IsNotEmpty() @MaxLength(40) memberNo: string;
  @IsOptional() @IsObject() profile?: Record<string, unknown>;
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true }) documentFileIds: string[];
}

class RegistrationBody extends ApplicationBody {
  @IsString() @IsNotEmpty() mobileProof: string;
  @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(10) nationalId?: string;
  @IsString() @MaxLength(128) password: string;
  @Equals(true) acceptTerms: boolean;
}

class ResubmitBody {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) memberNo?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsObject() profile?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) documentFileIds?: string[];
}

class ListQuery extends PageQuery {
  @IsOptional() @IsIn(STATUSES) status?: MembershipStatus;
  @IsOptional() @IsIn(['student', 'faculty', 'staff', 'guest']) kind?: MembershipKind;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class NoteBody {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class RejectBody extends ReasonBody {
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
}

class RevisionBody extends ReasonBody {
  @IsArray() @ArrayUnique() @IsIn(REVISABLE_FIELDS, { each: true }) fields: RevisableField[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) deadlineDays?: number;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
}

class TransferBody extends ReasonBody {
  @IsUUID() unitId: string;
}

class ImportQuery {
  @IsOptional() @Transform(({ value }) => value !== 'false' && value !== false) dryRun?: boolean;
}

class InviteBody {
  @IsIn(['faculty', 'staff', 'student']) kind: 'faculty' | 'staff' | 'student';
  @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
  @IsString() @MaxLength(20) mobile: string;
  @IsOptional() @IsEmail() email?: string;
  @IsUUID() unitId: string;
  @IsOptional() @IsString() @MaxLength(40) memberNo?: string;
}

@ApiTags('registration')
@Controller('v1')
export class RegistrationController {
  constructor(private readonly memberships: MembershipService) {}

  /** Anonymous registration into the tenant from X-Tenant / host (section 6). */
  @Public()
  @TenantScoped({ membership: 'any' })
  @Post('registrations')
  register(@Body() body: RegistrationBody) {
    return this.memberships.register(body);
  }

  @ApiBearerAuth()
  @TenantScoped({ membership: 'any' })
  @Post('memberships/apply')
  apply(@Body() body: ApplicationBody) {
    return this.memberships.apply(body);
  }

  @ApiBearerAuth()
  @Get('me/memberships')
  mine() {
    return this.memberships.mine();
  }

  @ApiBearerAuth()
  @TenantScoped({ membership: 'any' })
  @Get('me/membership')
  myApplication() {
    return this.memberships.myApplication();
  }

  @ApiBearerAuth()
  @TenantScoped({ membership: 'any' })
  @Patch('me/membership')
  resubmit(@Body() body: ResubmitBody) {
    return this.memberships.resubmit(body);
  }
}

@ApiTags('admin: memberships')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin/memberships')
export class MembershipAdminController {
  constructor(private readonly memberships: MembershipService) {}

  @RequirePermission('membership.view')
  @Get()
  list(@Query() q: ListQuery) {
    return this.memberships.list({ status: q.status, kind: q.kind, unitId: q.unitId, search: q.q, limit: q.limit, offset: q.offset });
  }

  @RequirePermission('membership.view')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.memberships.detail(id);
  }

  @RequirePermission('membership.approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: NoteBody) {
    return this.memberships.approve(id, body.note);
  }

  @RequirePermission('membership.approve')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: RejectBody) {
    return this.memberships.reject(id, body.reason, body.internalNote);
  }

  @RequirePermission('membership.approve')
  @Post(':id/request-revision')
  @HttpCode(200)
  requestRevision(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevisionBody) {
    return this.memberships.requestRevision(id, body);
  }

  @RequirePermission('membership.approve')
  @Post(':id/transfer')
  @HttpCode(200)
  transfer(@Param('id', ParseUUIDPipe) id: string, @Body() body: TransferBody) {
    return this.memberships.transfer(id, body.unitId, body.reason);
  }

  @RequirePermission('membership.manage')
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.memberships.setLifecycle(id, 'suspended', body.reason);
  }

  @RequirePermission('membership.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.memberships.setLifecycle(id, 'active', body.reason);
  }

  @RequirePermission('membership.manage')
  @Post(':id/end')
  @HttpCode(200)
  end(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.memberships.setLifecycle(id, 'ended', body.reason);
  }

  /** AUTH-16: `?dryRun=true` validates only; otherwise creates the valid rows and reports the rest. */
  @RequirePermission('membership.manage')
  @ApiConsumes('multipart/form-data')
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @Query() q: ImportQuery) {
    if (!file) throw new AppError('VALIDATION_FAILED', { field: 'file' });
    return this.memberships.importMembers(file.buffer, { dryRun: q.dryRun ?? true });
  }

  @RequirePermission('membership.manage')
  @Post('invite')
  invite(@Body() body: InviteBody) {
    return this.memberships.invite(body);
  }
}
