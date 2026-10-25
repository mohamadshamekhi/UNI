import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import type { formFieldSchema, slaSchema } from './definition.js';

type FormField = z.infer<typeof formFieldSchema>;
type Sla = z.infer<typeof slaSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
export const MAX_DATA_BYTES = 32_768;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Request / revision payloads: a small plain JSON object. */
export function assertCaseData(v: unknown): Record<string, unknown> {
  if (v === undefined) return {};
  if (!isPlainObject(v) || JSON.stringify(v).length > MAX_DATA_BYTES) throw new AppError('VALIDATION_FAILED', { field: 'data' });
  return v;
}

/**
 * Validates a step form submission against its field definitions and splits it into values the
 * applicant may see and staff-only values (THS-08). Unknown keys are rejected.
 */
export function validateForm(fields: FormField[], raw: unknown): { public: Record<string, unknown>; internal: Record<string, unknown> } {
  const values = raw === undefined ? {} : raw;
  if (!isPlainObject(values)) throw new AppError('VALIDATION_FAILED', { field: 'form' });
  const errors: Record<string, string> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const k of Object.keys(values)) if (!byKey.has(k)) errors[k] = 'unknown';

  const out = { public: {} as Record<string, unknown>, internal: {} as Record<string, unknown> };
  for (const f of fields) {
    const v = values[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) errors[f.key] = 'required';
      continue;
    }
    let ok: boolean;
    switch (f.type) {
      case 'text':
        ok = typeof v === 'string' && v.length <= 500;
        break;
      case 'textarea':
        ok = typeof v === 'string' && v.length <= 4000;
        break;
      case 'number':
        ok = typeof v === 'number' && Number.isFinite(v);
        break;
      case 'select':
        ok = typeof v === 'string' && !!f.options?.some((o) => o.value === v);
        break;
      case 'date':
        ok = typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
        break;
      case 'checkbox':
        ok = typeof v === 'boolean';
        break;
      case 'file':
        ok = (typeof v === 'string' && UUID.test(v)) || (Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === 'string' && UUID.test(x)));
        break;
    }
    if (!ok) errors[f.key] = 'invalid';
    else out[f.visibility === 'internal' ? 'internal' : 'public'][f.key] = v;
  }
  if (Object.keys(errors).length) throw new AppError('VALIDATION_FAILED', { fields: errors });
  return out;
}

/**
 * Task due date (WF-20). Business days skip Fridays; the tenant holiday calendar (WF-21) plugs
 * in here later.
 */
export function dueDate(from: Date, sla: Sla | undefined): Date | null {
  if (!sla) return null;
  const d = new Date(from);
  if (!sla.businessDays) {
    d.setUTCDate(d.getUTCDate() + sla.days);
    return d;
  }
  let left = sla.days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 5) left--;
  }
  return d;
}
