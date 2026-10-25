import type { z } from 'zod';
import type { SlaEntry } from '../../database/schema.js';
import type { slaSchema } from './definition.js';

type Sla = z.infer<typeof slaSchema>;
const DAY = 86_400_000;

export interface WorkCalendar {
  timeZone: string;
  /** weekly days off, 0 = Sunday … 6 = Saturday */
  weekend: Set<number>;
  /** YYYY-MM-DD in the calendar's time zone */
  holidays: Set<string>;
}

const dayFmt = new Map<string, Intl.DateTimeFormat>();
/** Calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function localDay(d: Date, timeZone: string): string {
  let f = dayFmt.get(timeZone);
  if (!f) dayFmt.set(timeZone, (f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(d);
}

const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

export const isWorkingDay = (d: Date, cal: WorkCalendar) => {
  const day = localDay(d, cal.timeZone);
  return !cal.weekend.has(weekdayOf(day)) && !cal.holidays.has(day);
};

/**
 * Task due date (WF-20): calendar days, or business days skipping weekend days and official /
 * university holidays. Time of day is kept.
 */
export function dueDate(from: Date, sla: Sla | undefined, cal: WorkCalendar): Date | null {
  if (!sla) return null;
  if (!sla.businessDays) return new Date(from.getTime() + sla.days * DAY);
  let d = from;
  let left = sla.days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isWorkingDay(d, cal)) left--;
  }
  return d;
}

/** WF-21: reminders before the deadline, at it, and after it. Times already past are dropped. */
export function slaSchedule(due: Date | null, sla: Sla | undefined, now: Date): SlaEntry[] {
  if (!due || !sla) return [];
  const entries: { at: Date; kind: SlaEntry['kind'] }[] = [
    ...sla.remindBefore.map((d) => ({ at: new Date(due.getTime() - d * DAY), kind: 'before' as const })),
    { at: due, kind: 'due' as const },
    ...sla.remindAfter.map((d) => ({ at: new Date(due.getTime() + d * DAY), kind: 'after' as const })),
  ];
  return entries
    .filter((e) => e.kind !== 'before' || e.at > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((e) => ({ at: e.at.toISOString(), kind: e.kind, done: false }));
}

export const nextAt = (s: SlaEntry[]) => {
  const n = s.find((e) => !e.done);
  return n ? new Date(n.at) : null;
};
