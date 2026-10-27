import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Queue, Worker } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { ENV, type Env } from '../../config/env.js';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { hmac, sha256 } from '../../common/util/crypto.js';
import { DbService } from '../../database/db.service.js';
import { fileObjects, tenants } from '../../database/schema.js';
import { RedisService } from '../../infra/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { clamavScan } from './clamav.js';
import { detectFileType, isUploadPurpose, UPLOAD_POLICIES, type UploadPurpose } from './file-type.js';
import { StorageService } from './storage.service.js';

export type FileRow = typeof fileObjects.$inferSelect;

/** Decides whether the current caller may read a file linked to a domain object. */
export type FileAccessResolver = (file: FileRow) => Promise<boolean>;

interface DownloadClaims {
  fid: string;
  tid: string;
  uid: string;
  jti: string;
  typ: 'file_download';
  /** inline preview allowed (images / PDF only), decided when the link is issued */
  inl?: boolean;
}

const INLINE_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const SCAN_QUEUE = 'files-scan';
const DOWNLOAD_TOKEN_TTL_SEC = 60;
const DEFAULT_QUOTA = 20 * 1024 ** 3;

@Injectable()
export class FilesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FilesService.name);
  private readonly resolvers = new Map<string, FileAccessResolver>();
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    if (this.env.FILE_SCAN_MODE !== 'clamav') return;
    const connection = this.redis.client.duplicate();
    this.queue = new Queue(SCAN_QUEUE, { connection });
    this.worker = new Worker(SCAN_QUEUE, (job) => this.scan(job.data.fileId as string), {
      connection: this.redis.client.duplicate(),
      concurrency: 2,
    });
    this.worker.on('failed', (job, err) => this.logger.warn({ err, fileId: job?.data?.fileId }, 'scan failed'));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  registerAccessResolver(linkedType: string, resolver: FileAccessResolver) {
    this.resolvers.set(linkedType, resolver);
  }

  /** Opaque subject binding a pre-account upload to the verified mobile that made it. */
  uploadSubject(mobile: string) {
    return hmac(this.env.HASH_PEPPER, `upload:${mobile}`);
  }

  async upload(input: {
    purpose: string;
    originalName: string;
    buffer: Buffer;
    ownerUserId?: string | null;
    uploadSubject?: string | null;
  }): Promise<FileRow> {
    const ctx = requestContext.get();
    const tenantId = ctx.tenant!.id;
    if (!isUploadPurpose(input.purpose)) throw new AppError('VALIDATION_FAILED', { field: 'purpose' });
    const policy = UPLOAD_POLICIES[input.purpose as UploadPurpose];
    if (input.buffer.length === 0) throw new AppError('VALIDATION_FAILED', { field: 'file' });
    if (input.buffer.length > policy.maxBytes) throw new AppError('FILE_TOO_LARGE', { maxBytes: policy.maxBytes });
    const detected = detectFileType(input.buffer);
    if (!detected || !(policy.mimes as readonly string[]).includes(detected.mime)) {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', { allowed: policy.mimes });
    }
    await this.assertQuota(tenantId, input.buffer.length);

    // random storage key under the tenant prefix; the original name lives only in the DB (FIL-02)
    const now = new Date();
    const key = `tenants/${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    await this.storage.put(key, input.buffer, detected.mime);

    const safeName = input.originalName.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || `file.${detected.ext}`;
    const name = extname(safeName) ? safeName : `${safeName}.${detected.ext}`;
    const skip = this.env.FILE_SCAN_MODE === 'skip';
    const [row] = await this.db.run((tx) =>
      tx
        .insert(fileObjects)
        .values({
          tenantId,
          ownerUserId: input.ownerUserId ?? null,
          uploadSubject: input.uploadSubject ?? null,
          purpose: input.purpose,
          originalName: name,
          mimeType: detected.mime,
          sizeBytes: input.buffer.length,
          sha256: sha256(input.buffer),
          storageKey: key,
          isConfidential: policy.confidential,
          scanStatus: skip ? 'skipped' : 'pending',
          scannedAt: skip ? new Date() : null,
        })
        .returning(),
    );
    await this.audit.record({ action: 'file.uploaded', targetType: 'file', targetId: row!.id, after: { purpose: input.purpose, size: row!.sizeBytes, mime: row!.mimeType } });
    // enqueue after commit would be ideal; the worker tolerates a not-yet-visible row by retrying
    await this.queue?.add('scan', { fileId: row!.id }, { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, jobId: row!.id });
    return row!;
  }

  private async assertQuota(tenantId: string, incoming: number) {
    const [t] = await this.db.sys.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const quota = t?.settings.storageQuotaBytes ?? DEFAULT_QUOTA;
    const [used] = await this.db.run((tx) =>
      tx
        .select({ bytes: sql<string>`coalesce(sum(${fileObjects.sizeBytes}), 0)` })
        .from(fileObjects)
        .where(isNull(fileObjects.deletedAt)),
    );
    if (Number(used?.bytes ?? 0) + incoming > quota) throw new AppError('FILE_QUOTA_EXCEEDED', { quotaBytes: quota });
  }

  /** Raw bytes of a stored file (server-side processing such as manuscript scrubbing). */
  async read(file: FileRow): Promise<Buffer> {
    return this.storage.getBuffer(file.storageKey);
  }

  /** Stream of a stored file for routes that do their own access checks (guest reviewers). */
  stream(file: FileRow) {
    return this.storage.get(file.storageKey);
  }

  /** Background scan (FIL-04); infected files stay quarantined and are never served. */
  async scan(fileId: string) {
    const [file] = await this.db.sys.select().from(fileObjects).where(eq(fileObjects.id, fileId));
    if (!file) throw new Error('file not visible yet');
    if (file.scanStatus !== 'pending') return;
    const data = await this.storage.getBuffer(file.storageKey);
    const verdict = await clamavScan(this.env.CLAMAV_HOST, this.env.CLAMAV_PORT, data);
    await this.db.sys.update(fileObjects).set({ scanStatus: verdict, scannedAt: new Date() }).where(eq(fileObjects.id, fileId));
    if (verdict === 'infected') {
      await this.audit.recordDetached({ action: 'file.quarantined', tenantId: file.tenantId, actorType: 'system', actorUserId: null, targetType: 'file', targetId: file.id });
    }
  }

  async get(fileId: string): Promise<FileRow> {
    const [file] = await this.db.run((tx) =>
      tx.select().from(fileObjects).where(and(eq(fileObjects.id, fileId), isNull(fileObjects.deletedAt))),
    );
    if (!file) throw new AppError('NOT_FOUND');
    return file;
  }

  async canRead(file: FileRow): Promise<boolean> {
    const ctx = requestContext.get();
    if (ctx.userId && file.ownerUserId === ctx.userId) return true;
    if (!file.linkedType) return false;
    const resolver = this.resolvers.get(file.linkedType);
    return resolver ? resolver(file) : false;
  }

  /**
   * Issues a single-use, user-bound download link valid for 60s (FIL-05/13), after checking
   * access at this moment. Views of confidential files are audited (FIL-06).
   */
  async issueDownload(fileId: string, opts: { inline?: boolean } = {}) {
    const ctx = requestContext.get();
    const file = await this.get(fileId);
    if (!(await this.canRead(file))) {
      await this.audit.recordDetached({ action: 'file.access.denied', result: 'denied', targetType: 'file', targetId: file.id });
      throw new AppError('NOT_FOUND');
    }
    if (file.scanStatus !== 'clean' && file.scanStatus !== 'skipped') throw new AppError('FILE_NOT_READY', { scanStatus: file.scanStatus });
    const inline = !!opts.inline && INLINE_MIMES.has(file.mimeType);
    const claims: DownloadClaims = { fid: file.id, tid: file.tenantId, uid: ctx.userId!, jti: randomUUID(), typ: 'file_download', ...(inline ? { inl: true } : {}) };
    const token = this.jwt.sign(claims, { secret: this.env.FILE_TOKEN_SECRET, expiresIn: DOWNLOAD_TOKEN_TTL_SEC, algorithm: 'HS256' });
    if (file.isConfidential) {
      await this.audit.record({ action: 'file.confidential.viewed', targetType: 'file', targetId: file.id, after: { purpose: file.purpose, mode: inline ? 'preview' : 'download' } });
    }
    return { url: `/v1/files/${file.id}/content?token=${encodeURIComponent(token)}`, expiresInSec: DOWNLOAD_TOKEN_TTL_SEC, inline };
  }

  async openDownload(fileId: string, token: string): Promise<{ file: FileRow; stream: Readable; inline: boolean }> {
    let claims: DownloadClaims;
    try {
      claims = this.jwt.verify<DownloadClaims>(token, { secret: this.env.FILE_TOKEN_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new AppError('FILE_TOKEN_INVALID');
    }
    if (claims.typ !== 'file_download' || claims.fid !== fileId) throw new AppError('FILE_TOKEN_INVALID');
    const fresh = await this.redis.client.set(`file:dl:${claims.jti}`, '1', 'EX', DOWNLOAD_TOKEN_TTL_SEC * 2, 'NX');
    if (fresh !== 'OK') throw new AppError('FILE_TOKEN_INVALID');
    const [file] = await this.db.withTenant(claims.tid, (tx) =>
      tx.select().from(fileObjects).where(and(eq(fileObjects.id, fileId), isNull(fileObjects.deletedAt))),
    );
    if (!file || (file.scanStatus !== 'clean' && file.scanStatus !== 'skipped')) throw new AppError('FILE_TOKEN_INVALID');
    return { file, stream: await this.storage.get(file.storageKey), inline: !!claims.inl && INLINE_MIMES.has(file.mimeType) };
  }

  /**
   * Public, non-confidential file of a tenant (e.g. its logo). Never serves confidential or
   * unscanned files, regardless of who asks.
   */
  async openPublic(tenantId: string, fileId: string, purpose: string): Promise<{ file: FileRow; stream: Readable } | null> {
    const [file] = await this.db.sys
      .select()
      .from(fileObjects)
      .where(and(eq(fileObjects.id, fileId), eq(fileObjects.tenantId, tenantId), eq(fileObjects.purpose, purpose), isNull(fileObjects.deletedAt)));
    if (!file || file.isConfidential || (file.scanStatus !== 'clean' && file.scanStatus !== 'skipped')) return null;
    return { file, stream: await this.storage.get(file.storageKey) };
  }

  /** Attaches uploaded files to a domain object; only unlinked files the caller uploaded. */
  async link(fileIds: string[], linkedType: string, linkedId: string, owner: { userId?: string; uploadSubject?: string }) {
    if (!fileIds.length) return [];
    return this.db.run(async (tx) => {
      const linked: FileRow[] = [];
      for (const id of new Set(fileIds)) {
        const [f] = await tx
          .update(fileObjects)
          .set({ linkedType, linkedId, ownerUserId: owner.userId ?? null })
          .where(
            and(
              eq(fileObjects.id, id),
              isNull(fileObjects.linkedId),
              isNull(fileObjects.deletedAt),
              owner.uploadSubject ? eq(fileObjects.uploadSubject, owner.uploadSubject) : eq(fileObjects.ownerUserId, owner.userId!),
            ),
          )
          .returning();
        if (!f) throw new AppError('VALIDATION_FAILED', { field: 'documentFileIds', fileId: id });
        linked.push(f);
      }
      return linked;
    });
  }

  listLinked(linkedType: string, linkedId: string) {
    return this.db.run((tx) =>
      tx
        .select({
          id: fileObjects.id,
          purpose: fileObjects.purpose,
          originalName: fileObjects.originalName,
          mimeType: fileObjects.mimeType,
          sizeBytes: fileObjects.sizeBytes,
          scanStatus: fileObjects.scanStatus,
          createdAt: fileObjects.createdAt,
        })
        .from(fileObjects)
        .where(and(eq(fileObjects.linkedType, linkedType), eq(fileObjects.linkedId, linkedId), isNull(fileObjects.deletedAt))),
    );
  }
}
