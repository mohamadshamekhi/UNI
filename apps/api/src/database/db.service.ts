import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import { requestContext } from '../common/context/request-context.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

interface TxScope {
  tenantId?: string | null;
  userId?: string | null;
}

/**
 * Two pools:
 *  - app    (uni_app, NOBYPASSRLS): all request traffic. Every transaction sets app.tenant_id /
 *           app.user_id so PostgreSQL RLS enforces tenant isolation (TEN-02).
 *  - system (uni_system, BYPASSRLS): background workers and explicit cross-tenant reads only.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly appPool: pg.Pool;
  private readonly systemPool: pg.Pool;
  readonly app: Db;
  readonly sys: Db;

  constructor(@Inject(ENV) env: Env) {
    this.appPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });
    this.systemPool = new pg.Pool({ connectionString: env.DATABASE_SYSTEM_URL, max: 5 });
    this.app = drizzle(this.appPool, { schema });
    this.sys = drizzle(this.systemPool, { schema });
  }

  /**
   * Executor for the current request: the request transaction when one is open, otherwise a
   * fresh transaction scoped from the request context.
   */
  async run<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    const ctx = requestContext.find();
    if (ctx?.tx) return fn(ctx.tx);
    return this.transaction({ tenantId: ctx?.tenant?.id, userId: ctx?.userId }, fn);
  }

  /** Opens an RLS-scoped transaction on the app pool. */
  async transaction<T>(scope: TxScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.app.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${scope.tenantId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  /**
   * Runs fn inside a savepoint of the request transaction, so one failing item (e.g. a row of a
   * bulk import) rolls back alone without aborting the whole request.
   */
  async savepoint<T>(fn: () => Promise<T>): Promise<T> {
    const ctx = requestContext.find();
    const outer = ctx?.tx;
    if (!outer || !ctx) return fn();
    return outer.transaction(async (sp) => {
      ctx.tx = sp;
      try {
        return await fn();
      } finally {
        ctx.tx = outer;
      }
    });
  }

  /**
   * Runs fn against a specific tenant (platform admin operations) while still under RLS. Inside a
   * request transaction the tenant setting is switched temporarily, keeping one atomic unit.
   */
  async withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = requestContext.find();
    const tx = ctx?.tx;
    if (!tx) return this.transaction({ tenantId, userId: ctx?.userId }, fn);
    const res = await tx.execute<{ prev: string | null }>(
      sql`select current_setting('app.tenant_id', true) as prev, set_config('app.tenant_id', ${tenantId}, true)`,
    );
    const prev = res.rows[0]?.prev ?? '';
    try {
      return await fn(tx);
    } finally {
      await tx.execute(sql`select set_config('app.tenant_id', ${prev}, true)`);
    }
  }

  /**
   * Background work for one tenant (outbox handlers, sweeps): one RLS transaction plus a request
   * context, so services that read the context (outbox, audit) write into the same transaction.
   */
  background<T>(tenantId: string, label: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction({ tenantId }, (tx) => requestContext.run({ requestId: label, tenant: { id: tenantId, slug: '', status: 'active' }, tx }, () => fn(tx)));
  }

  async onModuleDestroy() {
    await Promise.all([this.appPool.end(), this.systemPool.end()]);
  }
}
