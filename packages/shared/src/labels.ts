import type { CaseStatusCategory, ThesisStatus, MembershipKind, MembershipStatus, ScopeType, TenantStatus } from "./types";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const TENANT_STATUS: Record<TenantStatus, { label: string; tone: Tone }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  active: { label: "فعال", tone: "success" },
  suspended: { label: "معلق", tone: "warning" },
  archived: { label: "بایگانی", tone: "neutral" },
};

export const MEMBERSHIP_STATUS: Record<MembershipStatus, { label: string; tone: Tone }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  pending_review: { label: "در انتظار بررسی", tone: "info" },
  needs_revision: { label: "نیازمند اصلاح", tone: "warning" },
  active: { label: "فعال", tone: "success" },
  rejected: { label: "ردشده", tone: "danger" },
  suspended: { label: "معلق", tone: "warning" },
  ended: { label: "تمام‌شده", tone: "neutral" },
};

export const MEMBERSHIP_KIND: Record<MembershipKind, string> = {
  student: "دانشجو",
  faculty: "استاد",
  staff: "کارمند",
  guest: "مهمان",
};

export const SCOPE_TYPE: Record<ScopeType, string> = {
  tenant: "کل سازمان",
  unit: "فقط این واحد",
  unit_tree: "واحد و زیرمجموعه‌ها",
  case: "یک پرونده",
};

export const MODULES: Record<string, string> = {
  thesis: "پایان‌نامه",
  paper: "مقاله و داوری",
  news: "اخبار",
  events: "رویدادها",
  payment: "پرداخت",
  reporting: "گزارش‌ها",
};

export const PERMISSION_MODULES: Record<string, string> = {
  tenancy: "سازمان",
  org: "ساختار",
  acl: "نقش و دسترسی",
  membership: "عضویت",
  workflow: "گردش‌کار",
  files: "فایل",
  paper: "مقاله",
  news: "اخبار",
  events: "رویداد",
  reporting: "گزارش",
  audit: "ممیزی",
  payment: "پرداخت",
};

export const MEMBERSHIP_EVENT: Record<string, string> = {
  submitted: "ثبت درخواست",
  resubmitted: "ارسال مجدد پس از اصلاح",
  approved: "تأیید",
  rejected: "رد",
  revision_requested: "درخواست اصلاح",
  transferred: "انتقال به واحد دیگر",
  suspended: "تعلیق",
  reactivated: "فعال‌سازی مجدد",
  ended: "پایان عضویت",
  invited: "دعوت",
};

export const REVISABLE_FIELDS: Record<string, string> = {
  fullName: "نام و نام خانوادگی",
  memberNo: "شماره دانشجویی/پرسنلی",
  unitId: "واحد سازمانی",
  profile: "اطلاعات تحصیلی",
  documents: "مدارک",
};

export const AUDIT_RESULT: Record<string, { label: string; tone: Tone }> = {
  success: { label: "موفق", tone: "success" },
  denied: { label: "ردشده", tone: "danger" },
  error: { label: "خطا", tone: "warning" },
};

export const CASE_STATUS: Record<CaseStatusCategory, { label: string; tone: Tone }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  open: { label: "در جریان", tone: "info" },
  revising: { label: "نیازمند اصلاح", tone: "warning" },
  success: { label: "تأییدشده", tone: "success" },
  failure: { label: "ردشده", tone: "danger" },
  cancelled: { label: "لغوشده", tone: "neutral" },
};

/** Common workflow action names; definitions may use others, shown as-is. */
const CASE_ACTIONS: Record<string, string> = {
  approve: "تأیید",
  accept: "پذیرش",
  ok: "تأیید",
  reject: "رد",
  return_for_fix: "بازگشت برای اصلاح",
  revise: "درخواست اصلاح",
  forward: "ارسال به مرحله بعد",
  resubmit: "ارسال اصلاحیه",
  withdraw: "انصراف",
  success: "تأیید",
  failure: "رد",
  cancelled: "لغو",
  schedule: "تعیین جلسه دفاع",
  request_final_files: "درخواست فایل نهایی",
  pass: "قبول",
  fail: "مردود",
};
export const caseAction = (a: string | null | undefined) => (a ? (CASE_ACTIONS[a] ?? a) : "");

export const CASE_EVENT: Record<string, string> = {
  created: "ثبت پرونده",
  entered: "ورود به مرحله",
  action: "اقدام",
  decided: "مسیریابی خودکار",
  joined: "تکمیل بررسی‌های موازی",
  system: "اقدام سیستمی",
  returned: "بازگشت به متقاضی برای اصلاح",
  resubmitted: "ارسال اصلاحیه",
  withdrawn: "انصراف متقاضی",
  closed: "پایان پرونده",
  reassigned: "ارجاع مجدد",
  extended: "تمدید مهلت",
  escalated: "ارجاع به سطح بالاتر",
  overdue: "گذشت مهلت",
  expired: "بسته‌شدن خودکار پس از مهلت",
  advisor_changed: "تغییر استاد راهنما",
};

export const THESIS_STATUS: Record<ThesisStatus, { label: string; tone: Tone }> = {
  proposal: { label: "پیشنهاده", tone: "neutral" },
  in_progress: { label: "در حال انجام", tone: "info" },
  defense_scheduled: { label: "آماده دفاع", tone: "warning" },
  defended: { label: "دفاع‌شده", tone: "success" },
  failed: { label: "مردود", tone: "danger" },
  cancelled: { label: "لغوشده", tone: "neutral" },
};

export const DEGREE: Record<string, string> = { bsc: "کارشناسی", msc: "کارشناسی ارشد", phd: "دکتری" };
export const MY_ROLE: Record<string, string> = { advisor: "استاد راهنما", co_advisor: "استاد مشاور", reviewer: "داور" };
