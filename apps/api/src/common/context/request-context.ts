import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tx } from '../../database/db.service.js';

export interface TenantRef {
  id: string;
  slug: string;
  status: 'draft' | 'active' | 'suspended' | 'archived';
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  sessionId?: string;
  isPlatformAdmin?: boolean;
  tenant?: TenantRef;
  /** Tenant key the client asked for, kept when it did not resolve (→ TENANT_NOT_FOUND). */
  tenantRequested?: string;
  membershipId?: string;
  membershipStatus?: string;
  /** Guest reviewer session (PAP-11): no user account, one tenant, one reviewer. */
  guestId?: string;
  /** Active transaction for this request (RLS settings applied). */
  tx?: Tx;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) throw new Error('No request context');
    return ctx;
  },
  find(): RequestContext | undefined {
    return storage.getStore();
  },
};
