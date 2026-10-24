import { Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { DbService } from '../../database/db.service.js';
import { fileObjects, memberships, otpChallenges, outboxEvents, sessions, tenants } from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesModule } from '../files/files.module.js';
import { StorageService } from '../files/storage.service.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** OD-08 defaults: sessions kept 90 days; audit log is append-only and kept ≥ 2 years (AUD-07). */
const SESSION_KEEP_DAYS = 90;
const FILE_PURGE_GRACE_DAYS = 7;
const OUTBOX_KEEP_DAYS = 30;

export interface MaintenanceReport {
  otpDeleted: number;
  sessionsDeleted: number;
  outboxDeleted: number;
  documentsExpired: number;
  filesPurged: number;
}

/**
 * Hourly housekeeping (FIL-09, OD-08). Runs on one instance at a time via an advisory lock.
 * Audit records are never deleted here: they are append-only and outlive every other record.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.MAINTENANCE === 'off') return;
    this.timer = setInterval(() => void this.run().catch((err) => this.logger.error({ err }, 'maintenance failed')), HOUR);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<MaintenanceReport | null> {
    const report: MaintenanceReport = { otpDeleted: 0, sessionsDeleted: 0, outboxDeleted: 0, documentsExpired: 0, filesPurged: 0 };
    const locked = await this.db.sys.transaction(async (tx) => {
      const [row] = (await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('maintenance')) as ok`)).rows;
      if (!row?.ok) return false;

      report.otpDeleted = (await tx.delete(otpChallenges).where(lt(otpChallenges.createdAt, new Date(now.getTime() - DAY))).returning({ id: otpChallenges.id })).length;

      const sessionCutoff = new Date(now.getTime() - SESSION_KEEP_DAYS * DAY);
      report.sessionsDeleted = (
        await tx
          .delete(sessions)
          .where(or(lt(sessions.expiresAt, sessionCutoff), and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, sessionCutoff))))
          .returning({ id: sessions.id })
      ).length;

      report.outboxDeleted = (
        await tx
          .delete(outboxEvents)
          .where(and(isNotNull(outboxEvents.dispatchedAt), lt(outboxEvents.dispatchedAt, new Date(now.getTime() - OUTBOX_KEEP_DAYS * DAY))))
          .returning({ id: outboxEvents.id })
      ).length;

      // identity documents of decided memberships, per tenant policy
      const policies = await tx
        .select({ id: tenants.id, days: sql<number | null>`(${tenants.settings}->'retention'->>'membershipDocsDays')::int` })
        .from(tenants);
      for (const p of policies.filter((x) => x.days)) {
        const cutoff = new Date(now.getTime() - p.days! * DAY);
        const expired = await tx
          .update(fileObjects)
          .set({ deletedAt: now })
          .where(
            and(
              eq(fileObjects.tenantId, p.id),
              eq(fileObjects.linkedType, 'membership'),
              isNull(fileObjects.deletedAt),
              inArray(
                fileObjects.linkedId,
                tx
                  .select({ id: memberships.id })
                  .from(memberships)
                  .where(and(eq(memberships.tenantId, p.id), inArray(memberships.status, ['active', 'rejected', 'ended']), lt(memberships.decidedAt, cutoff))),
              ),
            ),
          )
          .returning({ id: fileObjects.id });
        if (expired.length) {
          report.documentsExpired += expired.length;
          await this.audit.recordDetached({
            action: 'file.retention.expired',
            tenantId: p.id,
            actorType: 'system',
            actorUserId: null,
            after: { count: expired.length, policyDays: p.days },
          });
        }
      }
      return true;
    });
    if (!locked) return null;

    // purge objects outside the transaction; a failed delete is retried next run
    const due = await this.db.sys
      .select({ id: fileObjects.id, key: fileObjects.storageKey })
      .from(fileObjects)
      .where(and(isNotNull(fileObjects.deletedAt), isNull(fileObjects.purgedAt), lt(fileObjects.deletedAt, new Date(now.getTime() - FILE_PURGE_GRACE_DAYS * DAY))))
      .limit(500);
    for (const f of due) {
      try {
        await this.storage.delete(f.key);
        await this.db.sys.update(fileObjects).set({ purgedAt: new Date() }).where(eq(fileObjects.id, f.id));
        report.filesPurged++;
      } catch (err) {
        this.logger.warn({ err, fileId: f.id }, 'file purge failed');
      }
    }
    if (Object.values(report).some((n) => n > 0)) this.logger.log(report, 'maintenance done');
    return report;
  }
}

@Module({ imports: [FilesModule], providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
