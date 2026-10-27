import type { NotificationChannel } from '../../database/schema.js';

// Notification catalog (section 13): which events exist, who receives them on which channels by
// default, the variables a template may use and the default Persian texts. Tenants override
// rules and templates in the database; the catalog itself only changes with the code.

export type Recipient = 'user' | 'applicant' | 'assignee' | 'author' | 'reviewer' | 'managers' | 'released_reviewers' | 'audience' | 'channel_approvers' | 'registrant' | 'registrants' | 'payer' | 'finance';

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

const paperVars = { ...tenant, trackingCode: { label: 'شناسه پیگیری' }, paperTitle: { label: 'عنوان مقاله', sensitive: true }, dueDate: { label: 'مهلت' } };

const newsVars = { ...tenant, postTitle: { label: 'عنوان خبر', sensitive: true }, channelName: { label: 'کانال' } };
const eventVars = { ...tenant, eventTitle: { label: 'عنوان رویداد' }, eventDate: { label: 'تاریخ رویداد' }, statusLabel: { label: 'وضعیت ثبت‌نام' }, reason: { label: 'دلیل', sensitive: true } };

const payVars = { ...tenant, paymentTitle: { label: 'عنوان پرداخت' }, trackingCode: { label: 'شناسه پیگیری' }, amount: { label: 'مبلغ (ریال)' }, dueDate: { label: 'مهلت' } };

export const CATALOG = {
  'payment.requested': {
    label: 'درخواست پرداخت',
    critical: false,
    vars: payVars,
    rules: [{ recipient: 'payer', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'پرداخت لازم است: {{paymentTitle}}', body: 'برای «{{paymentTitle}}» مبلغ {{amount}} ریال باید تا {{dueDate}} پرداخت شود. شناسه پیگیری: {{trackingCode}}' },
      sms: { body: '{{tenantName}}: پرداخت {{amount}} ریال بابت «{{paymentTitle}}» تا {{dueDate}} لازم است.' },
    },
  },
  'payment.succeeded': {
    label: 'پرداخت موفق',
    critical: true,
    vars: payVars,
    rules: [{ recipient: 'payer', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'پرداخت انجام شد', body: 'پرداخت {{amount}} ریال بابت «{{paymentTitle}}» با موفقیت انجام شد. شناسه پیگیری: {{trackingCode}}' },
      sms: { body: '{{tenantName}}: پرداخت {{amount}} ریال با شناسه {{trackingCode}} موفق بود.' },
    },
  },
  'payment.cancelled': {
    label: 'لغو درخواست پرداخت',
    critical: false,
    vars: payVars,
    rules: [{ recipient: 'payer', channels: ['inapp'] }],
    templates: { inapp: { subject: 'درخواست پرداخت بسته شد', body: 'درخواست پرداخت «{{paymentTitle}}» ({{trackingCode}}) لغو شد یا مهلت آن گذشت.' } },
  },
  'payment.review': {
    label: 'پرداخت نیازمند بررسی',
    critical: false,
    vars: payVars,
    rules: [{ recipient: 'finance', channels: ['inapp'] }],
    templates: { inapp: { subject: 'پرداخت نامشخص: {{trackingCode}}', body: 'نتیجه پرداخت {{trackingCode}} ({{amount}} ریال) نامشخص است و منتظر تصمیم کارشناس مالی است.' } },
  },
  'news.submitted': {
    label: 'ارسال خبر برای تأیید',
    critical: false,
    vars: newsVars,
    rules: [{ recipient: 'channel_approvers', channels: ['inapp'] }],
    templates: { inapp: { subject: 'خبر در انتظار تأیید', body: 'خبر «{{postTitle}}» در کانال {{channelName}} برای تأیید ارسال شده است.' } },
  },
  'news.returned': {
    label: 'برگشت خبر برای اصلاح',
    critical: false,
    vars: newsVars,
    rules: [{ recipient: 'author', channels: ['inapp'] }],
    templates: { inapp: { subject: 'خبر برای اصلاح برگشت', body: 'خبر «{{postTitle}}» برای اصلاح به شما برگردانده شد.' } },
  },
  'news.published': {
    label: 'انتشار خبر برای مخاطبان',
    critical: false,
    vars: newsVars,
    // NWS-13: in-app only by default (SMS to a whole audience is costly)
    rules: [{ recipient: 'audience', channels: ['inapp'] }],
    templates: { inapp: { subject: 'خبر تازه: {{postTitle}}', body: 'خبر «{{postTitle}}» در {{channelName}} منتشر شد.' } },
  },
  'event.registered': {
    label: 'ثبت‌نام در رویداد',
    critical: false,
    vars: eventVars,
    rules: [{ recipient: 'registrant', channels: ['inapp'] }],
    templates: { inapp: { subject: 'ثبت‌نام رویداد: {{eventTitle}}', body: 'ثبت‌نام شما در «{{eventTitle}}» ({{eventDate}}) انجام شد؛ وضعیت: {{statusLabel}}.' } },
  },
  'event.registration.decided': {
    label: 'نتیجه بررسی ثبت‌نام',
    critical: false,
    vars: eventVars,
    rules: [{ recipient: 'registrant', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'نتیجه ثبت‌نام: {{eventTitle}}', body: 'ثبت‌نام شما در «{{eventTitle}}» {{statusLabel}}.' },
      sms: { body: '{{tenantName}}: ثبت‌نام شما در رویداد «{{eventTitle}}» {{statusLabel}}.' },
    },
  },
  'event.promoted': {
    label: 'خروج از فهرست انتظار',
    critical: false,
    vars: eventVars,
    rules: [{ recipient: 'registrant', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'جای شما در رویداد باز شد', body: 'با آزاد شدن ظرفیت، ثبت‌نام شما در «{{eventTitle}}» ({{eventDate}}) {{statusLabel}}.' },
      sms: { body: '{{tenantName}}: ظرفیت رویداد «{{eventTitle}}» برای شما باز شد.' },
    },
  },
  'event.cancelled': {
    label: 'لغو رویداد',
    critical: true,
    vars: eventVars,
    rules: [{ recipient: 'registrants', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'رویداد لغو شد: {{eventTitle}}', body: 'رویداد «{{eventTitle}}» ({{eventDate}}) لغو شد. {{reason}}' },
      sms: { body: '{{tenantName}}: رویداد «{{eventTitle}}» ({{eventDate}}) لغو شد.' },
    },
  },
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
  // Paper review (section 9): no template ever names the other side (identity matrix, NTF-08)
  'paper.submitted': {
    label: 'ثبت مقاله',
    critical: false,
    vars: paperVars,
    rules: [
      { recipient: 'author', channels: ['inapp', 'sms'] },
      { recipient: 'managers', channels: ['inapp'] },
    ],
    templates: {
      inapp: { subject: 'مقاله ثبت شد: {{trackingCode}}', body: 'مقاله «{{paperTitle}}» با شناسه پیگیری {{trackingCode}} ثبت شد و در صف بررسی اولیه است.' },
      sms: { body: '{{tenantName}}: مقاله شما با شناسه پیگیری {{trackingCode}} ثبت شد.' },
    },
  },
  'paper.review.invited': {
    label: 'دعوت به داوری',
    critical: false,
    vars: paperVars,
    rules: [{ recipient: 'reviewer', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'دعوت به داوری مقاله', body: 'برای داوری مقاله «{{paperTitle}}» دعوت شده‌اید؛ لطفاً تا {{dueDate}} پاسخ و نظر خود را ثبت کنید.' },
      sms: { body: '{{tenantName}}: دعوت به داوری یک مقاله؛ مهلت {{dueDate}}. لطفاً وارد سامانه شوید.' },
    },
  },
  'paper.review.reminder': {
    label: 'یادآوری مهلت داوری',
    critical: true,
    vars: paperVars,
    rules: [{ recipient: 'reviewer', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'یادآوری داوری', body: 'مهلت داوری مقاله «{{paperTitle}}» {{dueDate}} است.' },
      sms: { body: '{{tenantName}}: یادآوری مهلت داوری مقاله ({{dueDate}}).' },
    },
  },
  'paper.review.declined': {
    label: 'رد دعوت داوری',
    critical: false,
    vars: paperVars,
    rules: [{ recipient: 'managers', channels: ['inapp'] }],
    templates: { inapp: { subject: 'دعوت داوری رد شد: {{trackingCode}}', body: 'یکی از داوران دعوت مقاله {{trackingCode}} را نپذیرفت؛ داور جایگزین انتخاب کنید.' } },
  },
  'paper.reviews_done': {
    label: 'تکمیل داوری‌ها',
    critical: false,
    vars: paperVars,
    rules: [{ recipient: 'managers', channels: ['inapp'] }],
    templates: { inapp: { subject: 'داوری‌ها کامل شد: {{trackingCode}}', body: 'نظر داوران مقاله {{trackingCode}} ثبت شد و منتظر تصمیم است.' } },
  },
  'paper.revision_requested': {
    label: 'درخواست اصلاح مقاله',
    critical: false,
    vars: paperVars,
    rules: [{ recipient: 'author', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'اصلاح مقاله {{trackingCode}}', body: 'اصلاح مقاله «{{paperTitle}}» خواسته شده است؛ نسخه جدید را تا {{dueDate}} ارسال کنید.' },
      sms: { body: '{{tenantName}}: اصلاح مقاله {{trackingCode}} خواسته شده؛ مهلت {{dueDate}}.' },
    },
  },
  'paper.revised': {
    label: 'ارسال نسخه اصلاح‌شده',
    critical: false,
    vars: paperVars,
    rules: [{ recipient: 'managers', channels: ['inapp'] }],
    templates: { inapp: { subject: 'نسخه اصلاح‌شده: {{trackingCode}}', body: 'نسخه جدید مقاله {{trackingCode}} رسید و آماده دور بعد داوری است.' } },
  },
  'paper.decided': {
    label: 'تصمیم نهایی مقاله',
    critical: false,
    vars: { ...paperVars, decisionLabel: { label: 'تصمیم' } },
    rules: [{ recipient: 'author', channels: ['inapp', 'sms'] }],
    templates: {
      inapp: { subject: 'تصمیم درباره مقاله {{trackingCode}}', body: 'تصمیم نهایی درباره مقاله «{{paperTitle}}»: {{decisionLabel}}.' },
      sms: { body: '{{tenantName}}: تصمیم نهایی مقاله {{trackingCode}}: {{decisionLabel}}.' },
    },
  },
  'paper.withdrawn': {
    label: 'انصراف نویسنده',
    critical: false,
    vars: paperVars,
    rules: [
      { recipient: 'released_reviewers', channels: ['inapp', 'sms'] },
      { recipient: 'managers', channels: ['inapp'] },
    ],
    templates: {
      inapp: { subject: 'مقاله از داوری خارج شد', body: 'مقاله «{{paperTitle}}» توسط نویسنده پس گرفته شد؛ داوری آن لازم نیست.' },
      sms: { body: '{{tenantName}}: مقاله‌ای که داوری آن به شما سپرده شده بود پس گرفته شد.' },
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
