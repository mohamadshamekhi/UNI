import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { requestContext } from '../../common/context/request-context.js';
import { DbService } from '../../database/db.service.js';
import { outboxEvents } from '../../database/schema.js';

export type OutboxHandler = (event: { id: number; tenantId: string | null; type: string; payload: Record<string, unknown> }) => Promise<void>;

const POLL_MS = 2000;
const MAX_ATTEMPTS = 8;

/**
 * Transactional outbox (section 13): events are written in the same transaction as the change,
 * then dispatched by a poller with retries. The idempotency key prevents duplicates (NTF-05).
 * Handlers are registered by consumers (e.g. the notification service).
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: DbService) {}

  on(type: string, handler: OutboxHandler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  /** `tenantId` overrides the request tenant (cross-tenant writes such as event registrations). */
  async emit(type: string, payload: Record<string, unknown>, idempotencyKey: string, tenantId: string | null = requestContext.find()?.tenant?.id ?? null) {
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
            for (const h of this.handlers.get(row.type) ?? []) await h({ id: row.id, tenantId: row.tenant_id, type: row.type, payload: row.payload });
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
}
