import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { requestContext } from '../../common/context/request-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { PageQuery } from '../../common/http/dto.js';
import { maskMobile } from '../../common/util/normalize.js';
import { DbService } from '../../database/db.service.js';
import {
  notificationDeliveries,
  notificationMutes,
  notificationRules,
  notifications,
  notificationTemplates,
  tenants,
  users,
  type DeliveryStatus,
  type NotificationChannel,
} from '../../database/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { CATALOG, isNotificationEvent, render, templateProblems, type NotificationEvent } from './catalog.js';
import { NotificationsService } from './notifications.service.js';

const CHANNELS: NotificationChannel[] = ['inapp', 'sms', 'email'];
const STATUSES: DeliveryStatus[] = ['queued', 'sent', 'delivered', 'failed', 'dead', 'skipped'];

class InboxQuery extends PageQuery {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unread?: boolean;
}

class PreferencesBody {
  @IsArray() @ArrayMaxSize(3) @IsIn(CHANNELS, { each: true }) muted: NotificationChannel[];
}

class TemplateBody {
  @IsString() event: string;
  @IsIn(CHANNELS) channel: NotificationChannel;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) body: string;
}

class RuleBody {
  @IsString() event: string;
  @IsString() recipient: string;
  @IsArray() @ArrayMaxSize(3) @IsIn(CHANNELS, { each: true }) channels: NotificationChannel[];
  @IsBoolean() enabled: boolean;
}

class DeliveryQuery extends PageQuery {
  @IsOptional() @IsIn(STATUSES) status?: DeliveryStatus;
  @IsOptional() @IsIn(CHANNELS) channel?: NotificationChannel;
}

const assertEvent = (e: string): NotificationEvent => {
  if (!isNotificationEvent(e)) throw new AppError('VALIDATION_FAILED', { field: 'event' });
  return e;
};

/** Sample values for template previews. */
const SAMPLE: Record<string, string> = {
  tenantName: 'دانشگاه نمونه',
  decisionLabel: 'تأیید شد',
  deadline: '۱۵ آبان ۱۴۰۵',
  workflowName: 'تصویب پروپوزال',
  caseRef: 'A1B2C3D4',
  caseTitle: 'عنوان نمونه',
  stepTitle: 'بررسی کارشناس',
  dueDate: '۲۰ آبان ۱۴۰۵',
  outcomeLabel: 'تأیید شد',
};

/** In-app inbox and personal channel preferences (NTF-09/10). */
@ApiTags('me: notifications')
@ApiBearerAuth()
@TenantScoped({ membership: 'any' })
@Controller('v1/me')
export class InboxController {
  constructor(private readonly db: DbService) {}

  private me() {
    const ctx = requestContext.get();
    if (!ctx.userId) throw new AppError('UNAUTHENTICATED');
    return { userId: ctx.userId, tenantId: ctx.tenant!.id };
  }

  @Get('notifications')
  async list(@Query() q: InboxQuery) {
    const me = this.me();
    return this.db.run(async (tx) => {
      const mine = eq(notifications.userId, me.userId);
      const where = q.unread ? and(mine, isNull(notifications.readAt)) : mine;
      const items = await tx
        .select({ id: notifications.id, event: notifications.event, title: notifications.title, body: notifications.body, link: notifications.link, createdAt: notifications.createdAt, readAt: notifications.readAt })
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(q.limit)
        .offset(q.offset);
      const [{ total }] = (await tx.select({ total: count() }).from(notifications).where(where)) as [{ total: number }];
      const [{ unread }] = (await tx.select({ unread: count() }).from(notifications).where(and(mine, isNull(notifications.readAt)))) as [{ unread: number }];
      return { items, total, unread };
    });
  }

  @Get('notifications/unread-count')
  async unread() {
    const me = this.me();
    const [{ unread }] = (await this.db.run((tx) =>
      tx.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, me.userId), isNull(notifications.readAt))),
    )) as [{ unread: number }];
    return { unread };
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(@Param('id', ParseUUIDPipe) id: string) {
    const me = this.me();
    const rows = await this.db.run((tx) =>
      tx
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, id), eq(notifications.userId, me.userId)))
        .returning({ id: notifications.id }),
    );
    if (!rows.length) throw new AppError('NOT_FOUND');
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll() {
    const me = this.me();
    await this.db.run((tx) =>
      tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, me.userId), isNull(notifications.readAt))),
    );
  }

  @Get('notification-preferences')
  async preferences() {
    const me = this.me();
    const rows = await this.db.run((tx) => tx.select({ channel: notificationMutes.channel }).from(notificationMutes).where(eq(notificationMutes.userId, me.userId)));
    return { muted: rows.map((r) => r.channel) };
  }

  /** Critical notifications (security, deadlines) ignore these settings (NTF-10). */
  @Put('notification-preferences')
  async setPreferences(@Body() body: PreferencesBody) {
    const me = this.me();
    const muted = [...new Set(body.muted)];
    await this.db.run(async (tx) => {
      await tx.delete(notificationMutes).where(eq(notificationMutes.userId, me.userId));
      if (muted.length) await tx.insert(notificationMutes).values(muted.map((channel) => ({ tenantId: me.tenantId, userId: me.userId, channel })));
    });
    return { muted };
  }
}

/** Tenant notification settings: templates, rules and the delivery report (NTF-02/03/06/11). */
@ApiTags('admin: notifications')
@ApiBearerAuth()
@TenantScoped()
@RequirePermission('tenant.settings.edit')
@Controller('v1/admin')
export class NotificationAdminController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every event with its variables, default texts and the tenant's overrides. */
  @Get('notification-templates')
  async templates() {
    const [overrides, rules] = await this.db.run((tx) => Promise.all([tx.select().from(notificationTemplates), tx.select().from(notificationRules)]));
    return Object.entries(CATALOG).map(([event, def]) => ({
      event,
      label: def.label,
      critical: def.critical,
      variables: Object.entries(def.vars).map(([key, v]) => ({ key, label: v.label, sensitive: 'sensitive' in v && !!v.sensitive })),
      rules: def.rules.map((r) => {
        const o = rules.find((x) => x.event === event && x.recipient === r.recipient);
        return { recipient: r.recipient, defaultChannels: r.channels, channels: o ? o.channels : r.channels, enabled: o ? o.enabled : true, customised: !!o };
      }),
      templates: CHANNELS.map((channel) => {
        const o = overrides.find((x) => x.event === event && x.channel === channel);
        const d = (def.templates as Partial<Record<NotificationChannel, { subject?: string; body: string }>>)[channel];
        return { channel, default: d ?? null, override: o ? { subject: o.subject, body: o.body, updatedAt: o.updatedAt } : null };
      }),
    }));
  }

  @Post('notification-templates/preview')
  @HttpCode(200)
  preview(@Body() body: TemplateBody) {
    const event = assertEvent(body.event);
    return {
      problems: templateProblems(event, body.channel, body),
      subject: body.subject ? render(body.subject, SAMPLE) : null,
      body: render(body.body, SAMPLE),
    };
  }

  @Put('notification-templates')
  async saveTemplate(@Body() body: TemplateBody) {
    const event = assertEvent(body.event);
    const problems = templateProblems(event, body.channel, body);
    if (problems.length) throw new AppError('VALIDATION_FAILED', { problems });
    const ctx = requestContext.get();
    const [row] = await this.db.run((tx) =>
      tx
        .insert(notificationTemplates)
        .values({ tenantId: ctx.tenant!.id, event, channel: body.channel, subject: body.subject ?? null, body: body.body, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [notificationTemplates.tenantId, notificationTemplates.event, notificationTemplates.channel, notificationTemplates.locale],
          set: { subject: body.subject ?? null, body: body.body, updatedAt: new Date(), updatedBy: ctx.userId },
        })
        .returning(),
    );
    await this.audit.record({ action: 'notification.template.saved', targetType: 'notification_template', targetId: row!.id, after: body });
    return row;
  }

  @Delete('notification-templates/:event/:channel')
  @HttpCode(204)
  async resetTemplate(@Param('event') e: string, @Param('channel') channel: string) {
    const event = assertEvent(e);
    if (!CHANNELS.includes(channel as NotificationChannel)) throw new AppError('VALIDATION_FAILED', { field: 'channel' });
    await this.db.run((tx) =>
      tx.delete(notificationTemplates).where(and(eq(notificationTemplates.event, event), eq(notificationTemplates.channel, channel as NotificationChannel))),
    );
    await this.audit.record({ action: 'notification.template.reset', targetType: 'notification_template', targetId: `${event}:${channel}` });
  }

  @Put('notification-rules')
  async saveRule(@Body() body: RuleBody) {
    const event = assertEvent(body.event);
    if (!CATALOG[event].rules.some((r) => r.recipient === body.recipient)) throw new AppError('VALIDATION_FAILED', { field: 'recipient' });
    const ctx = requestContext.get();
    const channels = [...new Set(body.channels)];
    const [row] = await this.db.run((tx) =>
      tx
        .insert(notificationRules)
        .values({ tenantId: ctx.tenant!.id, event, recipient: body.recipient, channels, enabled: body.enabled, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [notificationRules.tenantId, notificationRules.event, notificationRules.recipient],
          set: { channels, enabled: body.enabled, updatedAt: new Date(), updatedBy: ctx.userId },
        })
        .returning(),
    );
    await this.audit.record({ action: 'notification.rule.saved', targetType: 'notification_rule', targetId: row!.id, after: { event, recipient: body.recipient, channels, enabled: body.enabled } });
    return row;
  }

  /** Delivery report with masked recipients and SMS usage against the monthly cap. */
  @Get('notification-deliveries')
  async deliveries(@Query() q: DeliveryQuery) {
    const tenantId = requestContext.get().tenant!.id;
    return this.db.run(async (tx) => {
      const where = and(q.status ? eq(notificationDeliveries.status, q.status) : undefined, q.channel ? eq(notificationDeliveries.channel, q.channel) : undefined);
      const rows = await tx
        .select({
          id: notificationDeliveries.id,
          event: notificationDeliveries.event,
          channel: notificationDeliveries.channel,
          status: notificationDeliveries.status,
          attempts: notificationDeliveries.attempts,
          error: notificationDeliveries.error,
          createdAt: notificationDeliveries.createdAt,
          sentAt: notificationDeliveries.sentAt,
          recipientName: users.fullName,
          mobile: users.mobile,
        })
        .from(notificationDeliveries)
        .innerJoin(users, eq(users.id, notificationDeliveries.userId))
        .where(where)
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(q.limit)
        .offset(q.offset);
      const [{ total }] = (await tx.select({ total: count() }).from(notificationDeliveries).where(where)) as [{ total: number }];
      const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
      const quota = t?.settings.notifications?.smsMonthlyQuota ?? null;
      const sent = await this.notifications.smsSent(tenantId);
      return {
        items: rows.map(({ mobile, ...r }) => ({ ...r, recipient: maskMobile(mobile) })),
        total,
        sms: { sentThisMonth: sent, monthlyQuota: quota, nearQuota: quota !== null && sent >= quota * 0.8 },
      };
    });
  }
}
