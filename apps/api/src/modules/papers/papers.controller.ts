import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { Public, TenantScoped } from '../../common/auth/decorators.js';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { PageQuery, ReasonBody } from '../../common/http/dto.js';
import type { PaperStatus, Recommendation, ReviewMode } from '../../database/schema.js';
import { FilesService } from '../files/files.service.js';
import { GuestGuard, GuestsService } from './guests.service.js';
import { PapersService, type Decision, type ScreenDecision } from './papers.service.js';
import { PaperViews } from './papers.views.js';

const MODES: ReviewMode[] = ['open', 'single_blind', 'double_blind'];
const RECS: Recommendation[] = ['accept', 'accept_conditional', 'minor_revision', 'major_revision', 'reject'];
const STATUSES: PaperStatus[] = ['submitted', 'under_review', 'reviews_done', 'revision_requested', 'revised', 'accepted_conditional', 'accepted', 'rejected', 'withdrawn'];

class CoAuthorDto {
  @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
  @IsOptional() @IsUUID() membershipId?: string;
  @IsOptional() @IsString() @MaxLength(200) affiliation?: string;
}

class ConflictsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) membershipIds?: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class PaperBody {
  /** ignored for a conference paper: the event's track is used */
  @IsOptional() @IsUUID() trackId: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsString() @IsNotEmpty() @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(5000) abstract?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) keywords?: string[];
  @IsIn(['bsc', 'msc', 'phd', 'other']) degree: string;
  @IsOptional() @IsString() @MaxLength(120) field?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CoAuthorDto) coAuthors?: CoAuthorDto[];
  @IsOptional() @ValidateNested() @Type(() => ConflictsDto) conflicts?: ConflictsDto;
}

class PaperPatch {
  @IsOptional() @IsUUID() trackId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) abstract?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) keywords?: string[];
  @IsOptional() @IsIn(['bsc', 'msc', 'phd', 'other']) degree?: string;
  @IsOptional() @IsString() @MaxLength(120) field?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CoAuthorDto) coAuthors?: CoAuthorDto[];
  @IsOptional() @ValidateNested() @Type(() => ConflictsDto) conflicts?: ConflictsDto;
}

class SubmitBody {
  @IsUUID() manuscriptFileId: string;
}

class RevisionBody extends SubmitBody {
  @IsOptional() @IsString() @MaxLength(10000) responseLetter?: string;
  @IsOptional() @IsUUID() responseFileId?: string;
}

class ScreenBody {
  @IsIn(['send_to_review', 'request_fix', 'reject', 'forward']) decision: ScreenDecision;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsInt() @Min(1) @Max(120) revisionDays?: number;
  @IsOptional() @IsUUID() managerMembershipId?: string;
}

class ReviewerDto {
  @IsUUID() membershipId: string;
  @IsOptional() @IsInt() @Min(1) @Max(120) dueDays?: number;
}

class AssignBody {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ReviewerDto) reviewers: ReviewerDto[];
  @IsOptional() @IsBoolean() acknowledgeConflicts?: boolean;
}

class GuestBody {
  @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsInt() @Min(1) @Max(120) dueDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiresDays?: number;
}

class DecisionBody {
  @IsIn(['accept', 'accept_conditional', 'reject', 'minor_revision', 'major_revision']) decision: Decision;
  @IsOptional() @IsString() @MaxLength(5000) note?: string;
  @IsOptional() @IsInt() @Min(1) @Max(180) revisionDays?: number;
}

class RespondBody {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

class ReviewBody {
  @IsIn(RECS) recommendation: Recommendation;
  @IsString() @IsNotEmpty() @MaxLength(20000) commentsToAuthor: string;
  @IsOptional() @IsString() @MaxLength(10000) confidentialComments?: string;
  @IsOptional() @IsObject() scores?: Record<string, number>;
  @IsOptional() @IsUUID() attachmentFileId?: string;
}

class TrackBody {
  @IsString() @IsNotEmpty() @MaxLength(120) nameFa: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsIn(MODES) reviewMode: ReviewMode;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxRounds?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) reviewerDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) minReviewers?: number;
  @IsOptional() @IsBoolean() reviewerDownload?: boolean;
}

class TrackPatch {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nameFa?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(MODES) reviewMode?: ReviewMode;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxRounds?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) reviewerDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) minReviewers?: number;
  @IsOptional() @IsBoolean() reviewerDownload?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

class AdminListQuery extends PageQuery {
  @IsOptional() @IsIn(STATUSES) status?: PaperStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() eventId?: string;
}

class SessionBody {
  @IsString() @IsNotEmpty() @MaxLength(100) token: string;
}

@ApiTags('papers')
@ApiBearerAuth()
@TenantScoped()
@Controller('v1')
export class PapersController {
  constructor(
    private readonly papers: PapersService,
    private readonly views: PaperViews,
    private readonly guests: GuestsService,
  ) {}

  // author
  @Get('paper-tracks')
  tracks() {
    return this.papers.tracks();
  }

  @Get('me/papers')
  mine() {
    return this.papers.myPapers();
  }

  @Post('papers')
  async create(@Body() body: PaperBody) {
    const p = await this.papers.createDraft(body);
    return this.views.author(p.id);
  }

  @Get('papers/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.author(id);
  }

  @Patch('papers/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: PaperPatch) {
    await this.papers.updateDraft(id, body);
    return this.views.author(id);
  }

  @Post('papers/:id/submit')
  @HttpCode(200)
  async submit(@Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitBody) {
    await this.papers.submit(id, body.manuscriptFileId);
    return this.views.author(id);
  }

  @Post('papers/:id/revision')
  @HttpCode(200)
  async revision(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevisionBody) {
    await this.papers.submitRevision(id, body);
    return this.views.author(id);
  }

  @Post('papers/:id/withdraw')
  @HttpCode(200)
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    await this.papers.withdraw(id, body.reason);
    return this.views.author(id);
  }

  // reviewer (member)
  @Get('me/reviews')
  myReviews() {
    return this.papers.myReviews();
  }

  @Get('reviews/:id')
  review(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.reviewer(id, { membershipId: requestContext.get().membershipId });
  }

  @Post('reviews/:id/accept')
  @HttpCode(200)
  async accept(@Param('id', ParseUUIDPipe) id: string) {
    await this.papers.respond(id, { membershipId: requestContext.get().membershipId }, true);
    return this.views.reviewer(id, { membershipId: requestContext.get().membershipId });
  }

  @Post('reviews/:id/decline')
  @HttpCode(200)
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() body: RespondBody) {
    return this.papers.respond(id, { membershipId: requestContext.get().membershipId }, false, body.reason);
  }

  @Post('reviews/:id/submit')
  @HttpCode(200)
  async submitReview(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewBody) {
    const ctx = requestContext.get();
    await this.papers.submitReview(id, { membershipId: ctx.membershipId, userId: ctx.userId }, body);
    return this.views.reviewer(id, { membershipId: ctx.membershipId });
  }

  // manager
  @Get('admin/papers')
  list(@Query() q: AdminListQuery) {
    return this.papers.adminList(q);
  }

  @Get('admin/papers/:id')
  managerView(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.manager(id);
  }

  @Post('admin/papers/:id/screen')
  @HttpCode(200)
  async screen(@Param('id', ParseUUIDPipe) id: string, @Body() body: ScreenBody) {
    await this.papers.screen(id, body);
    return this.views.manager(id);
  }

  @Get('admin/papers/:id/reviewer-candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.papers.candidates(id);
  }

  @Post('admin/papers/:id/reviewers')
  @HttpCode(200)
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: AssignBody) {
    await this.papers.assignReviewers(id, body);
    return this.views.manager(id);
  }

  @Post('admin/papers/:id/guest-reviewers')
  inviteGuest(@Param('id', ParseUUIDPipe) id: string, @Body() body: GuestBody) {
    return this.guests.invite(id, body);
  }

  @Post('admin/paper-guests/:id/reissue')
  @HttpCode(200)
  reissue(@Param('id', ParseUUIDPipe) id: string) {
    return this.guests.reissue(id);
  }

  @Post('admin/paper-guests/:id/revoke')
  @HttpCode(200)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.guests.revoke(id, body.reason);
  }

  @Post('admin/paper-reviews/:id/cancel')
  @HttpCode(200)
  cancelReview(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonBody) {
    return this.papers.cancelReview(id, body.reason);
  }

  @Post('admin/papers/:id/decision')
  @HttpCode(200)
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionBody) {
    await this.papers.decide(id, body);
    return this.views.manager(id);
  }

  @Get('admin/paper-tracks')
  allTracks() {
    return this.papers.tracks(true);
  }

  @Post('admin/paper-tracks')
  createTrack(@Body() body: TrackBody) {
    return this.papers.createTrack(body);
  }

  @Patch('admin/paper-tracks/:id')
  updateTrack(@Param('id', ParseUUIDPipe) id: string, @Body() body: TrackPatch) {
    return this.papers.updateTrack(id, body);
  }
}

/** Guest reviewers: no account, one review, everything checked against the guest session. */
@ApiTags('guest review')
@Controller('v1/guest')
export class GuestReviewController {
  constructor(
    private readonly guests: GuestsService,
    private readonly papers: PapersService,
    private readonly views: PaperViews,
    private readonly files: FilesService,
  ) {}

  @Public()
  @Post('sessions')
  @HttpCode(200)
  session(@Body() body: SessionBody) {
    return this.guests.session(body.token);
  }

  private async current() {
    const gid = requestContext.get().guestId!;
    return { gid, review: await this.guests.currentReview(gid) };
  }

  @Public()
  @UseGuards(GuestGuard)
  @Get('review')
  async review() {
    const { gid, review } = await this.current();
    return this.views.reviewer(review.id, { guestId: gid });
  }

  @Public()
  @UseGuards(GuestGuard)
  @Post('review/accept')
  @HttpCode(200)
  async accept() {
    const { gid, review } = await this.current();
    await this.papers.respond(review.id, { guestId: gid }, true);
    return this.views.reviewer(review.id, { guestId: gid });
  }

  @Public()
  @UseGuards(GuestGuard)
  @Post('review/decline')
  @HttpCode(200)
  async decline(@Body() body: RespondBody) {
    const { gid, review } = await this.current();
    return this.papers.respond(review.id, { guestId: gid }, false, body.reason);
  }

  @Public()
  @UseGuards(GuestGuard)
  @Post('review/submit')
  @HttpCode(200)
  async submit(@Body() body: ReviewBody) {
    const { gid, review } = await this.current();
    await this.papers.submitReview(review.id, { guestId: gid }, body);
    return this.views.reviewer(review.id, { guestId: gid });
  }

  /** The manuscript of the guest's round (scrubbed copy in double-blind), under a neutral name. */
  @Public()
  @UseGuards(GuestGuard)
  @Get('review/manuscript')
  async manuscript(@Res() res: Response) {
    const { gid, review } = await this.current();
    const view = await this.views.reviewer(review.id, { guestId: gid });
    if (!view.manuscript?.downloadAllowed || !view.manuscript.ready) throw new AppError('FILE_NOT_READY');
    const file = await this.papers.manuscriptFor(review.id, { guestId: gid });
    const data = await this.files.read(file);
    await this.papers.guestAudit(gid, 'paper.guest.manuscript_downloaded', review.paperId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${view.manuscript.name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  }

  @Public()
  @UseGuards(GuestGuard)
  @Post('review/attachment')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async attachment(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new AppError('VALIDATION_FAILED', { field: 'file' });
    const gid = requestContext.get().guestId!;
    const row = await this.files.upload({ purpose: 'paper_review_attachment', originalName: 'review-attachment', buffer: file.buffer, ownerUserId: null, uploadSubject: `guest:${gid}` });
    return { id: row.id, sizeBytes: row.sizeBytes, mimeType: row.mimeType };
  }
}
