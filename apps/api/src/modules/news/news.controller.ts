import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
import type { Response } from 'express';
import { Public, TenantScoped } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { PageQuery, ReasonBody } from '../../common/http/dto.js';
import type { Audience, EventStatus, NewsStatus, RegistrationRule } from '../../database/schema.js';
import { FilesService } from '../files/files.service.js';
import { EventsService } from './events.service.js';
import { NewsService, type ChannelRole } from './news.service.js';

const POLICIES = ['direct', 'single', 'multi'] as const;
const CHANNEL_ROLES: ChannelRole[] = ['author', 'approver', 'publisher'];
const NEWS_STATUSES: NewsStatus[] = ['draft', 'pending_approval', 'approved', 'scheduled', 'published', 'archived', 'deleted'];
const EVENT_STATUSES: EventStatus[] = ['published', 'registration_open', 'registration_closed', 'held', 'cancelled'];

class ChannelBody {
  @IsString() @IsNotEmpty() @MaxLength(120) nameFa: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsIn(POLICIES) policy: (typeof POLICIES)[number];
  @IsOptional() @IsInt() @Min(1) @Max(5) approvalsRequired?: number;
}

class ChannelPatch {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nameFa?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(POLICIES) policy?: (typeof POLICIES)[number];
  @IsOptional() @IsInt() @Min(1) @Max(5) approvalsRequired?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ChannelMemberBody {
  @IsUUID() membershipId: string;
  @IsIn(CHANNEL_ROLES) role: ChannelRole;
}

class PostBody {
  @IsUUID() channelId: string;
  @IsString() @IsNotEmpty() @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @IsOptional() @IsString() @MaxLength(200_000) bodyHtml?: string;
  @IsOptional() @IsUUID() coverFileId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) attachmentFileIds?: string[];
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(300) source?: string;
  @IsObject() audience: Audience;
  @IsOptional() @IsDateString() expireAt?: string | null;
}

class PostPatch {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @IsOptional() @IsString() @MaxLength(200_000) bodyHtml?: string;
  @IsOptional() @IsUUID() coverFileId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) attachmentFileIds?: string[];
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(300) source?: string;
  @IsOptional() @IsObject() audience?: Audience;
  @IsOptional() @IsDateString() expireAt?: string | null;
}

class NoteBody {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class RequiredNoteBody {
  @IsString() @IsNotEmpty() @MaxLength(1000) note: string;
}

class PublishBody {
  @IsOptional() @IsDateString() publishAt?: string;
  @IsOptional() @IsDateString() expireAt?: string | null;
  @IsOptional() @IsBoolean() notify?: boolean;
}

class FeedQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsUUID() channelId?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
}

class ManageQuery extends PageQuery {
  @IsOptional() @IsIn(NEWS_STATUSES) status?: NewsStatus;
  @IsOptional() @IsUUID() channelId?: string;
}

class EventBody {
  @IsString() @IsNotEmpty() @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(200_000) descriptionHtml?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(200) organizer?: string;
  @IsOptional() @IsUUID() organizerUnitId?: string | null;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional() @IsString() @MaxLength(500) onlineUrl?: string;
  @IsOptional() @IsUUID() coverFileId?: string | null;
  @IsIn(['own_tenant', 'selected_tenants', 'public']) visibility: 'own_tenant' | 'selected_tenants' | 'public';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) visibleTenantIds?: string[];
  @IsObject() registrationRule: RegistrationRule;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number | null;
  @IsOptional() @IsBoolean() waitlist?: boolean;
  @IsOptional() @IsDateString() registrationDeadline?: string | null;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() allowCancel?: boolean;
  @IsOptional() @IsArray() form?: unknown[];
  @IsOptional() @IsUUID() newsPostId?: string | null;
  @IsOptional() @IsInt() @Min(1000) @Max(100_000_000_000) feeAmount?: number | null;
  @IsOptional() @IsUUID() paperTrackId?: string | null;
  @IsOptional() @IsDateString() paperDeadline?: string | null;
  @IsOptional() @IsObject() paperRule?: RegistrationRule | null;
}

class EventPatch {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(200_000) descriptionHtml?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(200) organizer?: string;
  @IsOptional() @IsUUID() organizerUnitId?: string | null;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional() @IsString() @MaxLength(500) onlineUrl?: string;
  @IsOptional() @IsUUID() coverFileId?: string | null;
  @IsOptional() @IsIn(['own_tenant', 'selected_tenants', 'public']) visibility?: 'own_tenant' | 'selected_tenants' | 'public';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) visibleTenantIds?: string[];
  @IsOptional() @IsObject() registrationRule?: RegistrationRule;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number | null;
  @IsOptional() @IsBoolean() waitlist?: boolean;
  @IsOptional() @IsDateString() registrationDeadline?: string | null;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() allowCancel?: boolean;
  @IsOptional() @IsArray() form?: unknown[];
  @IsOptional() @IsUUID() newsPostId?: string | null;
  @IsOptional() @IsInt() @Min(1000) @Max(100_000_000_000) feeAmount?: number | null;
  @IsOptional() @IsUUID() paperTrackId?: string | null;
  @IsOptional() @IsDateString() paperDeadline?: string | null;
  @IsOptional() @IsObject() paperRule?: RegistrationRule | null;
}

class EventStatusBody {
  @IsIn(EVENT_STATUSES) status: EventStatus;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

class EventsQuery extends PageQuery {
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() upcoming?: boolean;
}

class RegisterBody {
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
}

class DecideBody {
  @IsBoolean() approve: boolean;
}

class AttendanceBody {
  @IsBoolean() attended: boolean;
}

async function sendFile(res: Response, files: FilesService, file: Parameters<FilesService['read']>[0], cache: string) {
  const data = await files.read(file);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName ?? 'file')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(data);
}

/** Readers: feed, search and detail — anonymous visitors see public posts only (NWS-10). */
@ApiTags('news')
@Public()
@TenantScoped({ membership: 'any' })
@Controller('v1')
export class NewsFeedController {
  constructor(private readonly news: NewsService) {}

  @Get('news')
  feed(@Query() q: FeedQuery) {
    return this.news.feed(q);
  }

  @Get('news/:slug')
  detail(@Param('slug') slug: string) {
    return this.news.detail(slug);
  }
}

/** Header-less file routes for <img> tags: public posts' files and visible events' covers. */
@ApiTags('news')
@Public()
@Controller('v1/tenants/:tenant')
export class NewsPublicFilesController {
  constructor(
    private readonly news: NewsService,
    private readonly events: EventsService,
    private readonly files: FilesService,
  ) {}

  @Get('news/:slug/files/:fileId')
  async file(@Param('tenant') tenant: string, @Param('slug') slug: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const f = await this.news.publicFile(tenant, slug, fileId);
    await sendFile(res, this.files, f, 'public, max-age=300');
  }

  @Get('events/:id/cover')
  async cover(@Param('tenant') tenant: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.events.coverFile(tenant, id);
    await sendFile(res, this.files, f, 'public, max-age=300');
  }
}

/** Channels, editing and the publishing workflow. */
@ApiTags('news')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin')
export class NewsAdminController {
  constructor(private readonly news: NewsService) {}

  @Get('news-channels')
  channels() {
    return this.news.channels();
  }

  @Post('news-channels')
  createChannel(@Body() body: ChannelBody) {
    return this.news.createChannel(body);
  }

  @Patch('news-channels/:id')
  updateChannel(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChannelPatch) {
    return this.news.updateChannel(id, body);
  }

  @Get('news-channels/:id/members')
  members(@Param('id', ParseUUIDPipe) id: string) {
    return this.news.channelMembers(id);
  }

  @Post('news-channels/:id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChannelMemberBody) {
    return this.news.addChannelMember(id, body.membershipId, body.role);
  }

  @Delete('news-channels/:id/members/:membershipId/:role')
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('membershipId', ParseUUIDPipe) membershipId: string, @Param('role') role: string) {
    if (!CHANNEL_ROLES.includes(role as ChannelRole)) throw new AppError('VALIDATION_FAILED', { field: 'role' });
    return this.news.removeChannelMember(id, membershipId, role as ChannelRole);
  }

  @Get('news')
  list(@Query() q: ManageQuery) {
    return this.news.manageList(q);
  }

  @Post('news')
  async create(@Body() body: PostBody) {
    const p = await this.news.create(body);
    return this.news.manageGet(p.id);
  }

  @Get('news/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.news.manageGet(id);
  }

  @Get('news/:id/versions/:n')
  version(@Param('id', ParseUUIDPipe) id: string, @Param('n') n: string) {
    return this.news.version(id, Number(n));
  }

  @Patch('news/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: PostPatch) {
    await this.news.update(id, body);
    return this.news.manageGet(id);
  }

  @Post('news/:id/submit')
  @HttpCode(200)
  async submit(@Param('id', ParseUUIDPipe) id: string) {
    await this.news.submit(id);
    return this.news.manageGet(id);
  }

  @Post('news/:id/approve')
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: NoteBody) {
    await this.news.approve(id, body.note);
    return this.news.manageGet(id);
  }

  @Post('news/:id/return')
  @HttpCode(200)
  async returnForFix(@Param('id', ParseUUIDPipe) id: string, @Body() body: RequiredNoteBody) {
    await this.news.returnForFix(id, body.note);
    return this.news.manageGet(id);
  }

  @Post('news/:id/publish')
  @HttpCode(200)
  async publish(@Param('id', ParseUUIDPipe) id: string, @Body() body: PublishBody) {
    await this.news.publish(id, body);
    return this.news.manageGet(id);
  }

  @Post('news/:id/unpublish')
  @HttpCode(200)
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    await this.news.unpublish(id, body.reason);
    return this.news.manageGet(id);
  }

  @Post('news/:id/archive')
  @HttpCode(200)
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    await this.news.archive(id);
    return this.news.manageGet(id);
  }

  @Post('news/:id/restore')
  @HttpCode(200)
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    await this.news.restore(id);
    return this.news.manageGet(id);
  }

  @Post('news/:id/delete')
  @HttpCode(200)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    await this.news.softDelete(id, body.reason);
    return { id, status: 'deleted' };
  }
}

/** Participants: events visible to this university (own, shared and public ones) and registration. */
@ApiTags('events')
@Public()
@TenantScoped({ membership: 'any' })
@Controller('v1')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('events')
  list(@Query() q: EventsQuery) {
    return this.events.list(q);
  }

  @Get('events/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.detail(id);
  }

  @Post('events/:id/registrations')
  register(@Param('id', ParseUUIDPipe) id: string, @Body() body: RegisterBody) {
    return this.events.register(id, body.answers);
  }

  @Get('me/event-registrations')
  mine() {
    return this.events.mine();
  }

  @Post('me/event-registrations/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.cancel(id);
  }
}

/** Organisers (event.manage in the organiser unit's scope). */
@ApiTags('events')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1/admin')
export class EventsAdminController {
  constructor(private readonly events: EventsService) {}

  @Get('events')
  list() {
    return this.events.manageList();
  }

  @Get('event-partner-tenants')
  partners() {
    return this.events.partnerTenants();
  }

  @Post('events')
  create(@Body() body: EventBody) {
    return this.events.create(body);
  }

  @Get('events/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.manageGet(id);
  }

  @Patch('events/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: EventPatch) {
    return this.events.update(id, body);
  }

  @Post('events/:id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: EventStatusBody) {
    return this.events.setStatus(id, body.status, body.reason);
  }

  @Get('events/:id/registrations')
  registrations(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.registrations(id);
  }

  @Get('events/:id/registrations.csv')
  async export(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { filename, body } = await this.events.exportCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  @Post('event-registrations/:id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideBody) {
    return this.events.decide(id, body.approve);
  }

  @Post('event-registrations/:id/attendance')
  @HttpCode(200)
  attendance(@Param('id', ParseUUIDPipe) id: string, @Body() body: AttendanceBody) {
    return this.events.attendance(id, body.attended);
  }
}
