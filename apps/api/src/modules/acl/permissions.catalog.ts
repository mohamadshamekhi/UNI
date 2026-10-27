// Permission catalog (ACL-01/02): defined in code, synced to the `permissions` table at startup.
// Tenants compose roles from these; only the dev team / platform adds new codes.

export const PERMISSIONS = {
  'tenant.manage': { module: 'tenancy', description: 'مدیریت سازمان‌ها (مدیر کل)', platformOnly: true },
  'tenant.settings.edit': { module: 'tenancy', description: 'ویرایش تنظیمات سازمان' },
  'unit.manage': { module: 'org', description: 'مدیریت ساختار واحدها' },
  'role.manage': { module: 'acl', description: 'مدیریت نقش‌ها و انتساب‌ها' },
  'membership.view': { module: 'membership', description: 'مشاهده عضویت‌ها و درخواست‌ها' },
  'membership.approve': { module: 'membership', description: 'بررسی و تصمیم درباره درخواست عضویت' },
  'membership.manage': { module: 'membership', description: 'دعوت، انتقال، تعلیق و پایان عضویت' },
  'workflow.define': { module: 'workflow', description: 'تعریف گردش‌کار' },
  'workflow.publish': { module: 'workflow', description: 'انتشار نسخه گردش‌کار' },
  'case.create': { module: 'workflow', description: 'ثبت پرونده' },
  'case.review': { module: 'workflow', description: 'بررسی پرونده' },
  'case.assign': { module: 'workflow', description: 'ارجاع پرونده' },
  'case.view.scope': { module: 'workflow', description: 'مشاهده پرونده‌های دامنه' },
  'file.view.confidential': { module: 'files', description: 'مشاهده مدارک محرمانه' },
  'paper.submit': { module: 'paper', description: 'ارسال مقاله' },
  'paper.screen': { module: 'paper', description: 'بررسی اولیه مقاله' },
  'paper.assign_reviewer': { module: 'paper', description: 'تخصیص داور' },
  'paper.review': { module: 'paper', description: 'داوری مقاله' },
  'paper.decide': { module: 'paper', description: 'ثبت تصمیم نهایی مقاله' },
  'news.view': { module: 'news', description: 'مشاهده اخبار داخلی' },
  'news.create': { module: 'news', description: 'ایجاد خبر' },
  'news.approve': { module: 'news', description: 'تأیید خبر' },
  'news.publish': { module: 'news', description: 'انتشار خبر' },
  'news.unpublish': { module: 'news', description: 'لغو انتشار فوری خبر' },
  'news.manage': { module: 'news', description: 'مدیریت کانال‌های خبری و منتشرکنندگان' },
  'event.manage': { module: 'events', description: 'مدیریت رویداد' },
  'event.register': { module: 'events', description: 'ثبت‌نام در رویداد' },
  'report.view': { module: 'reporting', description: 'مشاهده گزارش‌ها' },
  'audit.view': { module: 'audit', description: 'مشاهده ممیزی سازمان' },
  'payment.view': { module: 'payment', description: 'مشاهده پرداخت‌ها' },
  'payment.manage': { module: 'payment', description: 'تعرفه‌ها، تنظیم درگاه و تصمیم درباره پرداخت‌های نامشخص' },
  'report.export': { module: 'reporting', description: 'خروجی گرفتن از گزارش‌ها' },
} as const satisfies Record<string, { module: string; description: string; platformOnly?: boolean }>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const isPermissionCode = (v: string): v is PermissionCode => Object.hasOwn(PERMISSIONS, v);

export const TENANT_PERMISSIONS = (Object.keys(PERMISSIONS) as PermissionCode[]).filter(
  (c) => !('platformOnly' in PERMISSIONS[c] && PERMISSIONS[c].platformOnly),
);

export interface RoleTemplate {
  key: string;
  nameFa: string;
  nameEn: string;
  permissions: PermissionCode[];
}

/**
 * System role templates (ACL-11), mirroring the default role × permission matrix in section 5.
 * Copied into every new tenant, where they can be customised. Scope limits (○ in the matrix)
 * come from the assignment scope, not the role.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'university_admin', nameFa: 'مدیر دانشگاه', nameEn: 'University admin', permissions: TENANT_PERMISSIONS },
  {
    key: 'expert',
    nameFa: 'کارشناس',
    nameEn: 'Expert',
    permissions: [
      'membership.view',
      'membership.approve',
      'case.review',
      'case.assign',
      'case.view.scope',
      'file.view.confidential',
      'news.view',
      'report.view',
    ],
  },
  {
    key: 'student',
    nameFa: 'دانشجو',
    nameEn: 'Student',
    permissions: ['case.create', 'paper.submit', 'news.view', 'event.register'],
  },
  {
    key: 'faculty',
    nameFa: 'استاد',
    nameEn: 'Faculty',
    permissions: ['case.review', 'case.view.scope', 'paper.submit', 'news.view', 'event.register'],
  },
  {
    key: 'review_manager',
    nameFa: 'مدیر بررسی',
    nameEn: 'Review manager',
    permissions: ['paper.screen', 'paper.assign_reviewer', 'paper.decide', 'paper.review', 'file.view.confidential', 'report.view'],
  },
  { key: 'reviewer', nameFa: 'داور', nameEn: 'Reviewer', permissions: ['paper.review', 'file.view.confidential'] },
  { key: 'guest_reviewer', nameFa: 'داور مهمان', nameEn: 'Guest reviewer', permissions: ['paper.review'] },
  {
    key: 'news_editor',
    nameFa: 'ویراستار خبر',
    nameEn: 'News editor',
    permissions: ['news.view', 'news.create', 'news.approve', 'news.publish'],
  },
  { key: 'finance_officer', nameFa: 'کارشناس مالی', nameEn: 'Finance officer', permissions: ['payment.view', 'payment.manage', 'report.view', 'report.export'] },
  { key: 'event_manager', nameFa: 'مسئول رویداد', nameEn: 'Event manager', permissions: ['event.manage', 'news.view', 'news.create'] },
];

/** Base role activated when a membership of this kind is approved (section 6, step 10). */
export const BASE_ROLE_BY_KIND: Record<string, string | undefined> = {
  student: 'student',
  faculty: 'faculty',
};
