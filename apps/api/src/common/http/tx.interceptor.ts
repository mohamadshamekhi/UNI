import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { requestContext } from '../context/request-context.js';
import { DbService } from '../../database/db.service.js';

/**
 * Runs each handler in one RLS-scoped transaction (tenant + user from the request context), so
 * a request either commits all its changes and audit rows or none.
 */
@Injectable()
export class TxInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = requestContext.get();
    return from(
      this.db.transaction({ tenantId: ctx.tenant?.id, userId: ctx.userId }, async (tx) => {
        ctx.tx = tx;
        try {
          return await lastValueFrom(next.handle(), { defaultValue: undefined });
        } finally {
          ctx.tx = undefined;
        }
      }),
    );
  }
}
