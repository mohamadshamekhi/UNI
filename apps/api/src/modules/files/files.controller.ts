import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Ctx, Public, TenantScoped } from '../../common/auth/decorators.js';
import type { RequestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { AclService } from '../acl/acl.service.js';
import { TokensService } from '../identity/tokens.service.js';
import { UPLOAD_POLICIES, isUploadPurpose } from './file-type.js';
import { FilesService } from './files.service.js';

class UploadBody {
  @IsString() @MaxLength(50) purpose: string;
}

class LinkBody {
  @IsOptional() @IsBoolean() inline?: boolean;
}

const MAX_UPLOAD = Math.max(...Object.values(UPLOAD_POLICIES).map((p) => p.maxBytes));

@ApiTags('files')
@Controller('v1/files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly tokens: TokensService,
    private readonly acl: AclService,
  ) {}

  /**
   * Multipart upload (field `file`). Signed-in users upload as themselves; during registration
   * an `X-Mobile-Proof` header authorises purposes that allow it (e.g. membership_document).
   */
  @Public()
  @TenantScoped({ membership: 'any' })
  @ApiConsumes('multipart/form-data')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadBody,
    @Headers('x-mobile-proof') proof: string | undefined,
    @Ctx() ctx: RequestContext,
  ) {
    if (!file) throw new AppError('VALIDATION_FAILED', { field: 'file' });
    // review copies are produced by the server from the author's manuscript, never uploaded
    if (!isUploadPurpose(body.purpose) || body.purpose === 'paper_review_copy') throw new AppError('VALIDATION_FAILED', { field: 'purpose' });
    let owner: { ownerUserId?: string; uploadSubject?: string };
    if (body.purpose === 'branding_logo') await this.acl.assert('tenant.settings.edit');
    if (ctx.userId) {
      owner = { ownerUserId: ctx.userId };
    } else {
      const policy = UPLOAD_POLICIES[body.purpose];
      if (!('allowProofUpload' in policy && policy.allowProofUpload)) throw new AppError('UNAUTHENTICATED');
      const claims = this.tokens.verifyProof(proof, ['register']);
      owner = { uploadSubject: this.files.uploadSubject(claims.sub) };
    }
    const row = await this.files.upload({
      purpose: body.purpose,
      originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      buffer: file.buffer,
      ...owner,
    });
    return { id: row.id, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, scanStatus: row.scanStatus };
  }

  @ApiBearerAuth()
  @TenantScoped({ membership: 'any' })
  @Post(':id/download-link')
  downloadLink(@Param('id', ParseUUIDPipe) id: string, @Body() body: LinkBody) {
    return this.files.issueDownload(id, { inline: body.inline });
  }

  /** Streams the file for a valid single-use token; never cached, never sniffed. */
  @Public()
  @Get(':id/content')
  async content(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string, @Res() res: Response) {
    const { file, stream, inline } = await this.files.openDownload(id, token ?? '');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // FIL-11: no active content. PDFs need the browser's viewer, which `sandbox` would block,
    // so they get a deny-all policy instead; images are fully sandboxed.
    res.setHeader('Content-Security-Policy', file.mimeType === 'application/pdf' && inline ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:" : "default-src 'none'; sandbox");
    stream.pipe(res);
  }
}
