import type { NotificationChannel } from '../../database/schema.js';

// Notification catalog (section 13): which events exist, who receives them on which channels by
// default, the variables a template may use and the default Persian texts. Tenants override
// rules and templates in the database; the catalog itself only changes with the code.

export type Recipient = 'user' | 'applicant' | 'assignee';

export interface VarDef {
  label: string;
  /** confidential values (titles, reasons) may appear in-app only, never in SMS/email (NTF-07) */
  sensitive?: boolean;
}

export interface TemplateText {
  subject?: string;
  body: string;
}

export interface EventDef {
  label: string;
  /** critical notifications ignore user mutes and quiet hours (NTF-10/13) */
  critical: boolean;
  vars: Record<string, VarDef>;
  rules: { recipient: Recipient; channels: NotificationChannel[] }[];
  templates: Partial<Record<NotificationChannel, TemplateText>>;
}

const tenant = { tenantName: { label: 'نام دانشگاه' } };
const caseVars = {
  ...tenant,
  workflowName: { label: 'نام فرایند' },
  caseRef: { label: 'شماره پرونده' },
  caseTitle: { label: 'عنوان پرونده', sensitive: true },
};
const taskVars = { ...caseVars, stepTitle: { label: 'عنوان مرحله' }, dueDate: { label: 'مهلت' } };

export const CATALOG = {
  'membership.invited': {
    label: 'دعوت به سامانه',
    critical: true,
    vars: tenant,
    rules: [{ recipient: 'user', channels: ['sms'] }],
    templates: {
      sms: { body: 'شما به سامانه {{tenantName}} دعوت شده‌اید. برای ورود، رمز عبور خود را از بخش «فراموشی رمز» تعیین کنید.' },
    },
  },
  'membership.decided': {
    label: 'تصمیم درباره عضویت',
    critical: false,
    vars: { ...tenant, decisionLabel: { label: 'نتیجه' } },
    rules: [{ recipient: 'user', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'درخواست عضویت {{decisionLabel}}', body: 'درخواست عضویت شما در {{tenantName}} {{decisionLabel}}. جزئیات را در صفحه وضعیت ببینید.' },
      sms: { body: '{{tenantName}}: درخواست عضویت شما {{decisionLabel}}. برای جزئیات وارد سامانه شوید.' },
    },
  },
  'membership.revision_requested': {
    label: 'درخواست اصلاح عضویت',
    critical: false,
    vars: { ...tenant, deadline: { label: 'مهلت اصلاح' } },
    rules: [{ recipient: 'user', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'درخواست عضویت نیاز به اصلاح دارد', body: 'لطفاً تا {{deadline}} موارد خواسته‌شده را اصلاح و دوباره ارسال کنید.' },
      sms: { body: '{{tenantName}}: درخواست عضویت شما نیاز به اصلاح دارد؛ مهلت تا {{deadline}}. لطفاً وارد سامانه شوید.' },
    },
  },
  'case.task.assigned': {
    label: 'ارجاع کار جدید',
    critical: false,
    vars: taskVars,
    rules: [{ recipient: 'assignee', channels: ['inapp'] }],
    templates: {
      inapp: { subject: 'کار جدید: {{stepTitle}}', body: 'پرونده {{caseRef}} ({{workflowName}}) در مرحله «{{stepTitle}}» به کارتابل شما آمد. مهلت: {{dueDate}}' },
      sms: { body: '{{tenantName}}: پرونده {{caseRef}} در مرحله «{{stepTitle}}» به کارتابل شما ارجاع شد.' },
    },
  },
  'case.returned': {
    label: 'بازگشت پرونده برای اصلاح',
    critical: false,
    vars: caseVars,
    rules: [{ recipient: 'applicant', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'پرونده نیاز به اصلاح دارد', body: 'پرونده {{caseRef}} ({{workflowName}}) برای اصلاح به شما برگشت. توضیحات را در پرونده ببینید.' },
      sms: { body: '{{tenantName}}: پرونده {{caseRef}} برای اصلاح به شما برگشت. لطفاً وارد سامانه شوید.' },
    },
  },
  'case.closed': {
    label: 'پایان پرونده',
    critical: false,
    vars: { ...caseVars, outcomeLabel: { label: 'نتیجه' } },
    rules: [{ recipient: 'applicant', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'پرونده {{caseRef}} {{outcomeLabel}}', body: 'رسیدگی به پرونده {{caseRef}} ({{workflowName}}) به پایان رسید: {{outcomeLabel}}.' },
      sms: { body: '{{tenantName}}: رسیدگی به پرونده {{caseRef}} به پایان رسید ({{outcomeLabel}}). جزئیات در سامانه.' },
    },
  },
  'case.task.reminder.before': {
    label: 'یادآوری پیش از مهلت',
    critical: false,
    vars: taskVars,
    rules: [{ recipient: 'assignee', channels: ['inapp'] }],
    templates: {
      inapp: { subject: 'یادآوری مهلت: {{stepTitle}}', body: 'مهلت رسیدگی به پرونده {{caseRef}} در مرحله «{{stepTitle}}» تا {{dueDate}} است.' },
      sms: { body: '{{tenantName}}: مهلت رسیدگی به پرونده {{caseRef}} تا {{dueDate}} است.' },
    },
  },
  'case.task.reminder.due': {
    label: 'پایان مهلت',
    critical: true,
    vars: taskVars,
    rules: [{ recipient: 'assignee', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'مهلت به پایان رسید: {{stepTitle}}', body: 'مهلت رسیدگی به پرونده {{caseRef}} در مرحله «{{stepTitle}}» امروز به پایان رسید.' },
      sms: { body: '{{tenantName}}: مهلت رسیدگی به پرونده {{caseRef}} به پایان رسید.' },
    },
  },
  'case.task.reminder.after': {
    label: 'تأخیر در رسیدگی',
    critical: true,
    vars: taskVars,
    rules: [{ recipient: 'assignee', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'تأخیر: {{stepTitle}}', body: 'رسیدگی به پرونده {{caseRef}} در مرحله «{{stepTitle}}» از مهلت ({{dueDate}}) گذشته است.' },
      sms: { body: '{{tenantName}}: رسیدگی به پرونده {{caseRef}} با تأخیر همراه است؛ لطفاً اقدام کنید.' },
    },
  },
  'case.task.escalated': {
    label: 'ارجاع به سطح بالاتر',
    critical: true,
    vars: taskVars,
    rules: [{ recipient: 'assignee', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'پرونده با تأخیر به شما ارجاع شد', body: 'پرونده {{caseRef}} در مرحله «{{stepTitle}}» پس از گذشت مهلت به شما ارجاع شد.' },
      sms: { body: '{{tenantName}}: پرونده {{caseRef}} پس از گذشت مهلت به شما ارجاع شد.' },
    },
  },
} as const satisfies Record<string, EventDef>;

export type NotificationEvent = keyof typeof CATALOG;
export const isNotificationEvent = (e: string): e is NotificationEvent => Object.hasOwn(CATALOG, e);
export const eventDef = (e: NotificationEvent): EventDef => CATALOG[e];

const VAR = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Variables used by a template body. */
export const templateVars = (text: string) => [...text.matchAll(VAR)].map((m) => m[1]!);

/**
 * NTF-02/07 check before saving a template: only declared variables, and no confidential ones
 * on channels that leave the system.
 */
export function templateProblems(event: NotificationEvent, channel: NotificationChannel, t: TemplateText): string[] {
  const def = eventDef(event);
  const problems: string[] = [];
  for (const v of templateVars(`${t.subject ?? ''} ${t.body}`)) {
    const d = def.vars[v];
    if (!d) problems.push(`unknown_variable:${v}`);
    else if (d.sensitive && channel !== 'inapp') problems.push(`sensitive_variable:${v}`);
  }
  if (channel === 'sms' && t.body.length > 280) problems.push('sms_too_long');
  return problems;
}

export const render = (text: string, vars: Record<string, string>) => text.replace(VAR, (_, k: string) => vars[k] ?? '');
