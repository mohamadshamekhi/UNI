import type { EventStatus, EventVisibility, NewsStatus, RegistrationStatus, ChannelPolicy, ChannelRole, CaseStatusCategory, PaperStatus, Recommendation, ReviewMode, ReviewStatus, ThesisStatus, MembershipKind, MembershipStatus, ScopeType, TenantStatus } from "./types";

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

export const PAPER_STATUS: Record<PaperStatus, { label: string; tone: Tone }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  submitted: { label: "در انتظار بررسی اولیه", tone: "info" },
  under_review: { label: "در حال داوری", tone: "info" },
  reviews_done: { label: "در انتظار تصمیم", tone: "warning" },
  revision_requested: { label: "در انتظار اصلاح", tone: "warning" },
  revised: { label: "اصلاح‌شده و ارسال مجدد", tone: "info" },
  accepted_conditional: { label: "پذیرش مشروط", tone: "success" },
  accepted: { label: "پذیرفته‌شده", tone: "success" },
  rejected: { label: "ردشده", tone: "danger" },
  withdrawn: { label: "انصراف", tone: "neutral" },
};

export const REVIEW_MODE: Record<ReviewMode, { label: string; hint: string }> = {
  open: { label: "آشکار", hint: "نویسنده و داوران یکدیگر را می‌شناسند." },
  single_blind: { label: "یک‌سوکور", hint: "داور نویسنده را می‌شناسد؛ نویسنده داور را نه." },
  double_blind: { label: "دوسوکور", hint: "هیچ‌کدام دیگری را نمی‌شناسند؛ داور نسخه پاک‌سازی‌شده را می‌بیند." },
};

export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: Tone }> = {
  invited: { label: "دعوت‌شده", tone: "info" },
  accepted: { label: "در حال داوری", tone: "warning" },
  declined: { label: "ردِ دعوت", tone: "neutral" },
  submitted: { label: "نظر ثبت شد", tone: "success" },
  cancelled: { label: "لغوشده", tone: "neutral" },
};

export const RECOMMENDATION: Record<Recommendation, { label: string; tone: Tone }> = {
  accept: { label: "پذیرش", tone: "success" },
  accept_conditional: { label: "پذیرش مشروط", tone: "success" },
  minor_revision: { label: "اصلاح جزئی", tone: "warning" },
  major_revision: { label: "اصلاح اساسی", tone: "warning" },
  reject: { label: "رد", tone: "danger" },
};

export const COI: Record<string, string> = {
  author: "نویسنده مقاله",
  co_author: "هم‌نویسنده",
  declared: "اعلام‌شده توسط نویسنده",
  same_unit: "هم‌واحد با نویسنده",
  past_coauthor: "هم‌نویسنده قبلی",
};

export const PAPER_EVENT: Record<string, string> = {
  submitted: "ثبت مقاله",
  "screen.send_to_review": "ارجاع به داوری",
  "screen.request_fix": "درخواست اصلاح اولیه",
  "screen.reject": "رد در بررسی اولیه",
  "screen.forward": "ارجاع به مسئول دیگر",
  "review.started": "آغاز داوری",
  "reviewers.assigned": "دعوت از داوران",
  "guest.invited": "دعوت از داور مهمان",
  "review.accepted": "پذیرش دعوت داوری",
  "review.declined": "رد دعوت داوری",
  "review.submitted": "ثبت نظر داور",
  "review.cancelled": "لغو دعوت داوری",
  "reviews.done": "تکمیل داوری‌ها",
  "revision.requested": "درخواست اصلاح",
  revised: "ارسال نسخه اصلاح‌شده",
  decided: "تصمیم نهایی",
  withdrawn: "انصراف نویسنده",
};

export const SCORE_CRITERIA: { key: string; label: string }[] = [
  { key: "novelty", label: "نوآوری" },
  { key: "methodology", label: "روش‌شناسی" },
  { key: "writing", label: "نگارش" },
];

export const NEWS_STATUS: Record<NewsStatus, { label: string; tone: Tone }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  pending_approval: { label: "در انتظار تأیید", tone: "warning" },
  approved: { label: "تأییدشده", tone: "info" },
  scheduled: { label: "زمان‌بندی‌شده", tone: "info" },
  published: { label: "منتشرشده", tone: "success" },
  archived: { label: "بایگانی", tone: "neutral" },
  deleted: { label: "حذف‌شده", tone: "danger" },
};

export const CHANNEL_POLICY: Record<ChannelPolicy, string> = {
  direct: "انتشار مستقیم",
  single: "یک تأیید",
  multi: "چند تأیید",
};

export const CHANNEL_ROLE: Record<ChannelRole, string> = {
  author: "نویسنده",
  approver: "تأییدکننده",
  publisher: "منتشرکننده",
};

export const EVENT_STATUS: Record<EventStatus, { label: string; tone: Tone }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  published: { label: "اعلام‌شده", tone: "info" },
  registration_open: { label: "ثبت‌نام باز", tone: "success" },
  registration_closed: { label: "ثبت‌نام بسته", tone: "warning" },
  held: { label: "برگزارشده", tone: "neutral" },
  cancelled: { label: "لغوشده", tone: "danger" },
};

export const REGISTRATION_STATUS: Record<RegistrationStatus, { label: string; tone: Tone }> = {
  registered: { label: "ثبت‌نام قطعی", tone: "success" },
  pending: { label: "در انتظار تأیید", tone: "warning" },
  approved: { label: "تأییدشده", tone: "success" },
  rejected: { label: "ردشده", tone: "danger" },
  cancelled: { label: "لغوشده", tone: "neutral" },
  waitlisted: { label: "فهرست انتظار", tone: "info" },
};

export const EVENT_VISIBILITY: Record<EventVisibility, string> = {
  own_tenant: "فقط این دانشگاه",
  selected_tenants: "دانشگاه‌های منتخب",
  public: "عمومی (همه)",
};
