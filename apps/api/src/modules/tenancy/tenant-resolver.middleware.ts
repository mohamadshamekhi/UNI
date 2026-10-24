import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { ENV, type Env } from '../../config/env.js';
import { requestContext, type TenantRef } from '../../common/context/request-context.js';
import { DbService } from '../../database/db.service.js';
import { tenants } from '../../database/schema.js';

const CACHE_TTL_MS = 15_000;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;

/**
 * Resolves the active tenant from `X-Tenant: <slug>` or the request host
 * (`<slug>.<TENANT_BASE_DOMAIN>` or a tenant's own domain). The tenant id is never taken from
 * client-supplied ids. Missing/unknown tenants are rejected later by TenantGuard.
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  private readonly cache = new Map<string, { at: number; tenant: TenantRef | null }>();

  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  invalidate() {
    this.cache.clear();
  }

  private keyFor(req: Request): { slug?: string; domain?: string } | null {
    const header = req.header('x-tenant')?.trim().toLowerCase();
    if (header) return SLUG_RE.test(header) ? { slug: header } : null;
    const host = (req.hostname ?? '').toLowerCase();
    const base = this.env.TENANT_BASE_DOMAIN.toLowerCase();
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      return SLUG_RE.test(sub) ? { slug: sub } : null;
    }
    if (host && host !== base && host !== 'localhost' && host !== '127.0.0.1') return { domain: host };
    return null;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      const key = this.keyFor(req);
      if (key === null && req.header('x-tenant')) requestContext.get().tenantRequested = req.header('x-tenant');
      if (key) {
        const cacheKey = key.slug ? `s:${key.slug}` : `d:${key.domain}`;
        const hit = this.cache.get(cacheKey);
        let tenant: TenantRef | null;
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
          tenant = hit.tenant;
        } else {
          const [row] = await this.db.sys
            .select({ id: tenants.id, slug: tenants.slug, status: tenants.status })
            .from(tenants)
            .where(key.slug ? eq(tenants.slug, key.slug) : or(eq(tenants.domain, key.domain!)))
            .limit(1);
          tenant = row ?? null;
          this.cache.set(cacheKey, { at: Date.now(), tenant });
        }
        if (tenant) requestContext.get().tenant = tenant;
        else requestContext.get().tenantRequested = key.slug ?? key.domain;
      }
      next();
    } catch (err) {
      next(err);
    }
  }
}
