import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { DbService } from '../../database/db.service.js';
import { outboxEvents, tenants, users } from '../../database/schema.js';
import { SmsProvider } from '../../infra/sms.js';

export type OutboxHandler = (event: { tenantId: string | null; type: string; payload: Record<string, unknown> }) => Promise<void>;

const POLL_MS = 2000;
const MAX_ATTEMPTS = 8;

/**
 * Transactional outbox (section 13): events are written in the same transaction as the change,
 * then dispatched by a poller with retries. The idempotency key prevents duplicates (NTF-05).
 * Phase 2 replaces the simple handlers below with the rule/template-driven notification service.
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly sms: SmsProvider,
  ) {
    this.registerDefaults();
  }

  on(type: string, handler: OutboxHandler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  async emit(type: string, payload: Record<string, unknown>, idempotencyKey: string) {
    const tenantId = requestContext.find()?.tenant?.id ?? null;
    await this.db.run((tx) =>
      tx.insert(outboxEvents).values({ tenantId, type, payload, idempotencyKey }).onConflictDoNothing(),
    );
  }

  onApplicationBootstrap() {
    if (process.env.OUTBOX_POLLING === 'off') return;
    this.timer = setInterval(() => void this.drain(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Dispatches a batch of due events. Safe to run concurrently across instances. */
  async drain(batch = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.db.sys.transaction(async (tx) => {
        const rows = (
          await tx.execute<{ id: number; tenant_id: string | null; type: string; payload: Record<string, unknown>; attempts: number }>(sql`
            select id, tenant_id, type, payload, attempts from outbox_events
             where dispatched_at is null and available_at <= now() and attempts < ${MAX_ATTEMPTS}
             order by id limit ${batch} for update skip locked`)
        ).rows;
        for (const row of rows) {
          try {
            for (const h of this.handlers.get(row.type) ?? []) await h({ tenantId: row.tenant_id, type: row.type, payload: row.payload });
            await tx.update(outboxEvents).set({ dispatchedAt: new Date() }).where(eq(outboxEvents.id, row.id));
          } catch (err) {
            const delaySec = Math.min(2 ** row.attempts * 5, 3600);
            await tx
              .update(outboxEvents)
              .set({
                attempts: row.attempts + 1,
                lastError: (err as Error).message.slice(0, 500),
                availableAt: sql`now() + make_interval(secs => ${delaySec})`,
              })
              .where(eq(outboxEvents.id, row.id));
            this.logger.warn({ err, id: row.id, type: row.type }, 'outbox handler failed');
          }
        }
        return rows.length;
      });
    } finally {
      this.running = false;
    }
  }

  private async userAndTenant(userId: string, tenantId: string | null) {
    const [u] = await this.db.sys.select({ mobile: users.mobile, fullName: users.fullName }).from(users).where(eq(users.id, userId));
    const [t] = tenantId ? await this.db.sys.select({ nameFa: tenants.nameFa }).from(tenants).where(eq(tenants.id, tenantId)) : [];
    return { user: u, tenantName: t?.nameFa ?? '' };
  }

  /** Phase-1 notifications: SMS to the applicant on decisions (section 13 table, row 2). */
  private registerDefaults() {
    const smsToUser = (text: (tenantName: string, p: Record<string, unknown>) => string): OutboxHandler =>
      async ({ tenantId, payload }) => {
        const { user, tenantName } = await this.userAndTenant(payload.userId as string, tenantId);
        if (!user) return;
        // NTF-07: no confidential details (reasons, documents) in SMS; the panel shows them
        await this.sms.send({ to: user.mobile, text: text(tenantName, payload), tenantId });
      };

    this.on(
      'membership.decided',
      smsToUser((t, p) =>
        p.decision === 'approved'
          ? `${t}: درخواست عضویت شما تأیید شد. اکنون می‌توانید وارد سامانه شوید.`
          : `${t}: درخواست عضویت شما رد شد. برای مشاهده دلیل وارد سامانه شوید.`,
      ),
    );
    this.on('membership.revision_requested', smsToUser((t) => `${t}: درخواست عضویت شما نیاز به اصلاح دارد. لطفاً در مهلت تعیین‌شده وارد سامانه شوید.`));
    this.on('membership.invited', smsToUser((t) => `شما به سامانه ${t} دعوت شده‌اید. برای ورود، رمز عبور خود را از بخش «فراموشی رمز» تعیین کنید.`));
  }
}
