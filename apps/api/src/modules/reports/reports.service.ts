import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DbService } from '../../database/db.service.js';
import { AclService, type UnitFilter } from '../acl/acl.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toCsv, toXlsx, type Table } from './export.js';

export interface ReportFilter {
  from?: string;
  to?: string;
  unitId?: string;
  requestType?: string;
}

const CATEGORY: Record<string, string> = { open: 'باز', revising: 'در حال اصلاح', success: 'موفق', failure: 'ناموفق', cancelled: 'لغوشده', draft: 'پیش‌نویس' };
const MEMBERSHIP: Record<string, string> = { pending_review: 'در انتظار بررسی', needs_revision: 'نیازمند اصلاح', active: 'تأییدشده', rejected: 'ردشده', suspended: 'معلق', expired: 'منقضی', invited: 'دعوت‌شده' };
const PAYMENT: Record<string, string> = { created: 'ایجادشده', pending: 'در انتظار پرداخت', succeeded: 'موفق', failed: 'ناموفق', cancelled: 'لغوشده', review: 'در انتظار بررسی', refunded: 'بازپرداخت‌شده' };
const PAPER: Record<string, string> = { accepted: 'پذیرفته', accepted_conditional: 'پذیرش مشروط', rejected: 'ردشده', withdrawn: 'منصرف' };
const DEGREE: Record<string, string> = { bsc: 'کارشناسی', msc: 'کارشناسی ارشد', phd: 'دکتری', other: 'سایر' };

export const REPORTS = {
  cases_by_status: 'تعداد پرونده‌ها به تفکیک وضعیت',
  open_tasks: 'کارهای باز به تفکیک مرحله و مسئول',
  step_durations: 'میانگین و میانه زمان مراحل',
  overdue: 'پرونده‌های دارای تأخیر',
  memberships: 'آمار عضویت',
  papers: 'آمار مقالات',
  news: 'آمار اخبار',
  events: 'آمار رویدادها',
  finance: 'گزارش مالی',
} as const;
export type ReportKey = keyof typeof REPORTS;
export const isReportKey = (k: string): k is ReportKey => Object.hasOwn(REPORTS, k);

const hours = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

/**
 * Management reports (section 15). Every query runs under tenant RLS and the viewer's unit scope for
 * `report.view` (AUD-08); identities in review reports follow the review mode (AUD-11: none here);
 * exports need `report.export` and are audited (AUD-09).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly acl: AclService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return Object.entries(REPORTS).map(([key, title]) => ({ key, title }));
  }

  private period(col: SQL, f: ReportFilter) {
    return sql`${f.from ? sql`${col} >= ${f.from}::timestamptz` : sql`true`} and ${f.to ? sql`${col} < ${f.to}::timestamptz` : sql`true`}`;
  }

  /** Unit scope of the viewer, plus an optional unit (with its subtree) chosen in the filter. */
  private unitScope(scope: UnitFilter, f: ReportFilter, unitIdCol: SQL) {
    const viewer = AclService.unitPredicate(scope, unitIdCol, sql`(select path from org_units where id = ${unitIdCol})`);
    const chosen = f.unitId
      ? sql`exists (select 1 from org_units u, org_units c where u.id = ${unitIdCol} and c.id = ${f.unitId} and u.path like c.path || '%')`
      : sql`true`;
    return sql`(${viewer}) and (${chosen})`;
  }

  private async tenantWide(scope: UnitFilter) {
    if (!scope.all) throw new AppError('FORBIDDEN', { permission: 'report.view', scope: 'tenant' });
  }

  async run(key: ReportKey, f: ReportFilter): Promise<Table> {
    await this.acl.assert('report.view');
    const scope = await this.acl.filterFor('report.view');
    return this.db.run(async (tx) => {
      const q = async <T extends Record<string, unknown>>(query: SQL) => (await tx.execute<T>(query)).rows;
      switch (key) {
        case 'cases_by_status': {
          const rows = await q<{ request_type: string; status: string; n: number }>(sql`
            select c.request_type, c.status_category as status, count(*)::int as n from cases c
            where ${this.period(sql`c.created_at`, f)} and ${this.unitScope(scope, f, sql`c.unit_id`)}
              ${f.requestType ? sql`and c.request_type = ${f.requestType}` : sql``}
            group by 1, 2 order by 1, 2`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'requestType', label: 'نوع درخواست' },
              { key: 'status', label: 'وضعیت' },
              { key: 'count', label: 'تعداد', type: 'number' },
            ],
            rows: rows.map((r) => ({ requestType: r.request_type, status: CATEGORY[r.status] ?? r.status, statusKey: r.status, count: r.n })),
          };
        }
        case 'open_tasks': {
          const rows = await q<{ request_type: string; step_id: string; assignee: string; n: number; overdue: number }>(sql`
            select c.request_type, t.step_id,
                   coalesce(u.full_name, case t.assignee_type when 'role' then 'نقش: ' || t.role_key when 'applicant' then 'متقاضی' end) as assignee,
                   count(*)::int as n, count(*) filter (where t.due_at < now())::int as overdue
            from case_tasks t join cases c on c.id = t.case_id
            left join memberships m on m.id = t.assignee_membership_id left join users u on u.id = m.user_id
            where t.status = 'open' and ${this.unitScope(scope, f, sql`c.unit_id`)}
              ${f.requestType ? sql`and c.request_type = ${f.requestType}` : sql``}
            group by 1, 2, 3 order by n desc limit 500`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'requestType', label: 'نوع درخواست' },
              { key: 'step', label: 'مرحله' },
              { key: 'assignee', label: 'مسئول' },
              { key: 'count', label: 'تعداد', type: 'number' },
              { key: 'overdue', label: 'گذشته از مهلت', type: 'number' },
            ],
            rows: rows.map((r) => ({ requestType: r.request_type, step: r.step_id, assignee: r.assignee, count: r.n, overdue: r.overdue })),
          };
        }
        case 'step_durations': {
          const rows = await q<{ request_type: string; step_id: string; n: number; mean_h: string; median_h: string }>(sql`
            select c.request_type, t.step_id, count(*)::int as n,
                   avg(extract(epoch from t.completed_at - t.created_at) / 3600) as mean_h,
                   percentile_cont(0.5) within group (order by extract(epoch from t.completed_at - t.created_at) / 3600) as median_h
            from case_tasks t join cases c on c.id = t.case_id
            where t.status = 'done' and t.completed_at is not null and t.assignee_type <> 'applicant'
              and ${this.period(sql`t.completed_at`, f)} and ${this.unitScope(scope, f, sql`c.unit_id`)}
              ${f.requestType ? sql`and c.request_type = ${f.requestType}` : sql``}
            group by 1, 2 order by 1, mean_h desc`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'requestType', label: 'نوع درخواست' },
              { key: 'step', label: 'مرحله' },
              { key: 'count', label: 'تعداد', type: 'number' },
              { key: 'meanHours', label: 'میانگین (ساعت)', type: 'number' },
              { key: 'medianHours', label: 'میانه (ساعت)', type: 'number' },
            ],
            rows: rows.map((r) => ({ requestType: r.request_type, step: r.step_id, count: r.n, meanHours: hours(r.mean_h), medianHours: hours(r.median_h) })),
          };
        }
        case 'overdue': {
          const rows = await q<{ case_id: string; request_type: string; title: string | null; step_id: string; due_at: Date; delay_h: string; unit: string | null }>(sql`
            select c.id as case_id, c.request_type, c.title, t.step_id, t.due_at, extract(epoch from now() - t.due_at) / 3600 as delay_h, ou.name_fa as unit
            from case_tasks t join cases c on c.id = t.case_id left join org_units ou on ou.id = c.unit_id
            where t.status = 'open' and t.due_at < now() and ${this.unitScope(scope, f, sql`c.unit_id`)}
              ${f.requestType ? sql`and c.request_type = ${f.requestType}` : sql``}
            order by t.due_at asc limit 1000`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'caseRef', label: 'شماره پرونده' },
              { key: 'requestType', label: 'نوع درخواست' },
              { key: 'step', label: 'مرحله' },
              { key: 'unit', label: 'واحد' },
              { key: 'dueAt', label: 'مهلت', type: 'date' },
              { key: 'delayHours', label: 'تأخیر (ساعت)', type: 'number' },
            ],
            rows: rows.map((r) => ({ caseId: r.case_id, caseRef: r.case_id.slice(0, 8).toUpperCase(), requestType: r.request_type, step: r.step_id, unit: r.unit, dueAt: r.due_at, delayHours: hours(r.delay_h) })),
          };
        }
        case 'memberships': {
          const rows = await q<{ kind: string; status: string; n: number; mean_h: string | null }>(sql`
            select m.kind, m.status, count(*)::int as n,
                   avg(extract(epoch from m.decided_at - m.submitted_at) / 3600) filter (where m.decided_at is not null and m.submitted_at is not null) as mean_h
            from memberships m
            where ${this.period(sql`m.created_at`, f)}
              and ${this.unitScope(scope, f, sql`coalesce(m.review_unit_id, (select unit_id from membership_units mu where mu.membership_id = m.id and mu.is_primary limit 1))`)}
            group by 1, 2 order by 1, 2`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'kind', label: 'نوع عضویت' },
              { key: 'status', label: 'وضعیت' },
              { key: 'count', label: 'تعداد', type: 'number' },
              { key: 'meanDecisionHours', label: 'میانگین زمان تأیید (ساعت)', type: 'number' },
            ],
            rows: rows.map((r) => ({ kind: r.kind, status: MEMBERSHIP[r.status] ?? r.status, count: r.n, meanDecisionHours: hours(r.mean_h) })),
          };
        }
        case 'papers': {
          // counts only — no author or reviewer identity (AUD-11)
          const rows = await q<{ degree: string; unit: string | null; status: string; n: number }>(sql`
            select p.degree, ou.name_fa as unit, p.status, count(*)::int as n
            from papers p
            left join membership_units mu on mu.membership_id = p.author_membership_id and mu.is_primary
            left join org_units ou on ou.id = mu.unit_id
            where p.status <> 'draft' and ${this.period(sql`p.submitted_at`, f)} and ${this.unitScope(scope, f, sql`mu.unit_id`)}
            group by 1, 2, 3 order by 1, 2, 3`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'degree', label: 'مقطع' },
              { key: 'unit', label: 'واحد' },
              { key: 'status', label: 'وضعیت' },
              { key: 'count', label: 'تعداد', type: 'number' },
            ],
            rows: rows.map((r) => ({ degree: DEGREE[r.degree] ?? r.degree, unit: r.unit ?? '—', status: PAPER[r.status] ?? r.status, statusKey: r.status, count: r.n })),
          };
        }
        case 'news': {
          await this.tenantWide(scope);
          const rows = await q<{ title: string; channel: string; published_at: Date; public: boolean; views: number }>(sql`
            select np.title, nc.name_fa as channel, np.published_at, coalesce((np.audience->>'public')::boolean, false) as public,
                   coalesce((select sum(v.views) from news_post_views v where v.post_id = np.id
                     and ${this.period(sql`v.day::timestamptz`, f)}), 0)::int as views
            from news_posts np join news_channels nc on nc.id = np.channel_id
            where np.published_at is not null and ${this.period(sql`np.published_at`, f)}
            order by views desc, np.published_at desc limit 500`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'title', label: 'عنوان' },
              { key: 'channel', label: 'کانال' },
              { key: 'audience', label: 'مخاطب' },
              { key: 'publishedAt', label: 'تاریخ انتشار', type: 'date' },
              { key: 'views', label: 'بازدید', type: 'number' },
            ],
            rows: rows.map((r) => ({ title: r.title, channel: r.channel, audience: r.public ? 'عمومی' : 'داخلی', publishedAt: r.published_at, views: r.views })),
          };
        }
        case 'events': {
          await this.tenantWide(scope);
          const rows = await q<{ title: string; starts_at: Date; total: number; confirmed: number; waitlisted: number; attended: number; own: number; guests: number; students: number; staff: number }>(sql`
            select e.title, e.starts_at,
                   count(r.id) filter (where r.status <> 'cancelled')::int as total,
                   count(r.id) filter (where r.status in ('registered', 'approved'))::int as confirmed,
                   count(r.id) filter (where r.status = 'waitlisted')::int as waitlisted,
                   count(r.id) filter (where r.attended_at is not null)::int as attended,
                   count(r.id) filter (where r.status <> 'cancelled' and r.home_tenant_id = e.tenant_id)::int as own,
                   count(r.id) filter (where r.status <> 'cancelled' and r.home_tenant_id <> e.tenant_id)::int as guests,
                   count(r.id) filter (where r.status <> 'cancelled' and m.kind = 'student')::int as students,
                   count(r.id) filter (where r.status <> 'cancelled' and m.kind in ('staff', 'faculty'))::int as staff
            from events e left join event_registrations r on r.event_id = e.id left join memberships m on m.id = r.membership_id
            where e.status <> 'draft' and ${this.period(sql`e.starts_at`, f)}
            group by e.id order by e.starts_at desc limit 500`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'title', label: 'رویداد' },
              { key: 'startsAt', label: 'زمان', type: 'date' },
              { key: 'total', label: 'ثبت‌نام', type: 'number' },
              { key: 'confirmed', label: 'قطعی', type: 'number' },
              { key: 'waitlisted', label: 'انتظار', type: 'number' },
              { key: 'attended', label: 'حاضر', type: 'number' },
              { key: 'students', label: 'دانشجو', type: 'number' },
              { key: 'staff', label: 'کارمند/استاد', type: 'number' },
              { key: 'guests', label: 'دانشگاه‌های دیگر', type: 'number' },
            ],
            rows: rows.map((r) => ({ title: r.title, startsAt: r.starts_at, total: r.total, confirmed: r.confirmed, waitlisted: r.waitlisted, attended: r.attended, students: r.students, staff: r.staff, guests: r.guests })),
          };
        }
        case 'finance': {
          // PAY-11: finance totals need the payment permission as well
          await this.acl.assert('payment.view');
          const rows = await q<{ service_key: string; title: string; status: string; n: number; total: string }>(sql`
            select service_key, min(title) as title, status, count(*)::int as n, coalesce(sum(amount), 0)::text as total
            from payment_requests where ${this.period(sql`created_at`, f)}
            group by 1, 3 order by 1, 3`);
          return {
            title: REPORTS[key],
            columns: [
              { key: 'serviceKey', label: 'کد خدمت' },
              { key: 'title', label: 'خدمت' },
              { key: 'status', label: 'وضعیت' },
              { key: 'count', label: 'تعداد', type: 'number' },
              { key: 'total', label: 'مبلغ (ریال)', type: 'number' },
            ],
            rows: rows.map((r) => ({ serviceKey: r.service_key, title: r.title, status: PAYMENT[r.status] ?? r.status, statusKey: r.status, count: r.n, total: Number(r.total) })),
          };
        }
      }
    });
  }

  /** AUD-09: exports need their own permission and are written to the audit log. */
  async export(key: ReportKey, f: ReportFilter, format: 'csv' | 'xlsx') {
    await this.acl.assert('report.export');
    const table = await this.run(key, f);
    await this.audit.record({ action: 'report.exported', targetType: 'report', targetId: key, after: { format, rows: table.rows.length, filter: f } });
    const stamp = new Date().toISOString().slice(0, 10);
    return format === 'csv'
      ? { filename: `${key}-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(toCsv(table), 'utf8') }
      : { filename: `${key}-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: toXlsx(table) };
  }

  /** Headline numbers for the dashboard cards (same scope rules). */
  async summary() {
    await this.acl.assert('report.view');
    const scope = await this.acl.filterFor('report.view');
    return this.db.run(async (tx) => {
      const unit = this.unitScope(scope, {}, sql`c.unit_id`);
      const [cases] = (
        await tx.execute<{ open: number; overdue: number; closed30: number }>(sql`
          select count(*) filter (where c.status_category in ('open', 'revising'))::int as open,
                 (select count(distinct t.case_id)::int from case_tasks t join cases c on c.id = t.case_id where t.status = 'open' and t.due_at < now() and ${unit}) as overdue,
                 count(*) filter (where c.closed_at > now() - interval '30 days')::int as closed30
          from cases c where ${unit}`)
      ).rows;
      const [members] = (await tx.execute<{ pending: number }>(sql`select count(*)::int as pending from memberships where status = 'pending_review'`)).rows;
      const finance = (await this.acl.has('payment.view'))
        ? (
            await tx.execute<{ paid30: string; review: number }>(sql`
              select coalesce(sum(amount) filter (where status = 'succeeded' and paid_at > now() - interval '30 days'), 0)::text as paid30,
                     count(*) filter (where status = 'review')::int as review
              from payment_requests`)
          ).rows[0]
        : null;
      return {
        openCases: cases?.open ?? 0,
        overdueCases: cases?.overdue ?? 0,
        closedLast30Days: cases?.closed30 ?? 0,
        pendingMemberships: scope.all ? (members?.pending ?? 0) : null,
        paidLast30Days: finance ? Number(finance.paid30) : null,
        paymentsInReview: finance ? finance.review : null,
      };
    });
  }
}
