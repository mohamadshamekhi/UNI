import { Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Executor } from '../../database/db.service.js';
import { calendarHolidays, tenants } from '../../database/schema.js';
import { localDay, type WorkCalendar } from './calendar.js';

const DEFAULT_WEEKEND = [5]; // Friday
const HORIZON_DAYS = 800;

/** Builds the working calendar of a tenant: weekend days, time zone and holidays (WF-20). */
@Injectable()
export class CalendarService {
  async load(tx: Executor, tenantId: string, from = new Date()): Promise<WorkCalendar> {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const timeZone = t?.settings.timezone ?? 'Asia/Tehran';
    const start = localDay(new Date(from.getTime() - 86_400_000), timeZone);
    const end = localDay(new Date(from.getTime() + HORIZON_DAYS * 86_400_000), timeZone);
    const rows = await tx
      .select({ day: calendarHolidays.day })
      .from(calendarHolidays)
      .where(and(or(isNull(calendarHolidays.tenantId), eq(calendarHolidays.tenantId, tenantId)), gte(calendarHolidays.day, start), lte(calendarHolidays.day, end)));
    return { timeZone, weekend: new Set(t?.settings.weekendDays ?? DEFAULT_WEEKEND), holidays: new Set(rows.map((r) => r.day)) };
  }
}
