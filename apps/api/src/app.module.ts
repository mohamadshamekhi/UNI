import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AuthGuard, PermissionGuard, TenantGuard } from './common/auth/guards.js';
import { ErrorFilter } from './common/errors/error.filter.js';
import { ContextMiddleware } from './common/http/context.middleware.js';
import { HealthController } from './common/http/health.controller.js';
import { TxInterceptor } from './common/http/tx.interceptor.js';
import { EnvModule } from './config/config.module.js';
import { loadEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './infra/redis.js';
import { SmsModule } from './infra/sms.js';
import { AclModule } from './modules/acl/acl.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.service.js';
import { MembershipModule } from './modules/membership/membership.module.js';
import { OrgModule } from './modules/org/org.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PapersModule } from './modules/papers/papers.module.js';
import { NewsModule } from './modules/news/news.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { ThesisModule } from './modules/thesis/thesis.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { TenantResolverMiddleware } from './modules/tenancy/tenant-resolver.middleware.js';

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        genReqId: (req) => {
          const h = req.headers['x-request-id'];
          return typeof h === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(h) ? h : randomUUID();
        },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-mobile-proof"]', 'req.query.token'],
        transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        autoLogging: env.NODE_ENV !== 'test',
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    EnvModule,
    DatabaseModule,
    RedisModule,
    SmsModule,
    AuditModule,
    OutboxModule,
    IdentityModule,
    AclModule,
    TenancyModule,
    OrgModule,
    FilesModule,
    MembershipModule,
    WorkflowModule,
    NotificationsModule,
    ThesisModule,
    PapersModule,
    NewsModule,
    PaymentsModule,
    ReportsModule,
    MaintenanceModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ErrorFilter },
    // order = access decision path: rate limit → identity → tenant/membership → permission
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TxInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware, TenantResolverMiddleware).forRoutes('*path');
  }
}
