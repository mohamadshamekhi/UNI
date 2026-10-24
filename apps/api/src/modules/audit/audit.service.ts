import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { DbService } from '../../database/db.service.js';
import { auditLogs } from '../../database/schema.js';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  result?: 'success' | 'denied' | 'error';
  /** Defaults to the request tenant. `null` writes to the platform chain. */
  tenantId?: string | null;
  actorUserId?: string | null;
  actorType?: 'user' | 'system';
}

const SENSITIVE = /pass(word)?|secret|token|otp|code_?hash|national_?id|refresh|cvv|card/i;

/** Masks sensitive fields before they reach the audit trail (AUD: «پنهان‌سازی فیلدهای حساس»). */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? '***' : maskSensitive(v, depth + 1),
      ]),
    );
  }
  return value;
}

export interface AuditQuery {
  tenantId: string | null;
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DbService) {}

  private row(entry: AuditEntry) {
    const ctx = requestContext.find();
    return {
      tenantId: entry.tenantId === undefined ? (ctx?.tenant?.id ?? null) : entry.tenantId,
      actorType: entry.actorType ?? (ctx?.userId || entry.actorUserId ? 'user' : 'system'),
      actorUserId: entry.actorUserId === undefined ? (ctx?.userId ?? null) : entry.actorUserId,
      actorMembershipId: ctx?.membershipId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: entry.before === undefined ? null : maskSensitive(entry.before),
      after: entry.after === undefined ? null : maskSensitive(entry.after),
      result: entry.result ?? 'success',
      reason: entry.reason ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 400) ?? null,
      requestId: ctx?.requestId ?? null,
    } as const;
  }

  /** Writes inside the current request transaction: rolled back together with the change. */
  async record(entry: AuditEntry): Promise<void> {
    const row = this.row(entry);
    const ctxTenant = requestContext.find()?.tenant?.id ?? null;
    if (row.tenantId && row.tenantId !== ctxTenant) {
      // platform operation writing into a tenant's chain
      await this.db.withTenant(row.tenantId, (tx) => tx.insert(auditLogs).values(row));
      return;
    }
    await this.db.run((tx) => tx.insert(auditLogs).values(row));
  }

  /**
   * Writes outside the request transaction (denials, failed logins) so the record survives the
   * rollback of the request. Never throws.
   */
  async recordDetached(entry: AuditEntry): Promise<void> {
    try {
      await this.db.sys.insert(auditLogs).values(this.row(entry));
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'Failed to write detached audit entry');
    }
  }

  search(q: AuditQuery) {
    return this.query(q, false);
  }

  /** Cross-tenant read for platform admins (callers must audit the access themselves). */
  searchAsSystem(q: AuditQuery) {
    return this.query(q, true);
  }

  private async query(q: AuditQuery, asSystem: boolean) {
    const where: SQL[] = [q.tenantId ? eq(auditLogs.tenantId, q.tenantId) : sql`${auditLogs.tenantId} is null`];
    if (q.actorUserId) where.push(eq(auditLogs.actorUserId, q.actorUserId));
    if (q.action) where.push(eq(auditLogs.action, q.action));
    if (q.targetType) where.push(eq(auditLogs.targetType, q.targetType));
    if (q.targetId) where.push(eq(auditLogs.targetId, q.targetId));
    if (q.from) where.push(gte(auditLogs.occurredAt, q.from));
    if (q.to) where.push(lte(auditLogs.occurredAt, q.to));
    // tenant reads go through RLS; the platform chain is only readable via the system pool
    const exec = q.tenantId && !asSystem ? undefined : this.db.sys;
    const query = (x: Pick<DbService['sys'], 'select'>) =>
      x
        .select()
        .from(auditLogs)
        .where(and(...where))
        .orderBy(desc(auditLogs.seq))
        .limit(q.limit)
        .offset(q.offset);
    return exec ? query(exec) : this.db.run((tx) => query(tx));
  }

  /** Returns null when the chain is intact, else the first tampered row. */
  async verifyChain(tenantId: string | null): Promise<{ id: string; seq: number } | null> {
    const res = await this.db.sys.execute<{ broken_id: string; broken_seq: string }>(
      sql`select * from audit_verify_chain(${tenantId}::uuid)`,
    );
    const row = res.rows[0];
    return row ? { id: row.broken_id, seq: Number(row.broken_seq) } : null;
  }
}
