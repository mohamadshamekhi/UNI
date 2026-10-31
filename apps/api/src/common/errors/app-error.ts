import { HttpStatus } from '@nestjs/common';

/**
 * Stable error codes exposed to clients. Frontends switch on `code`, never on message text.
 */
export const ErrorCodes = {
  VALIDATION_FAILED: [HttpStatus.BAD_REQUEST, 'اطلاعات ارسال‌شده معتبر نیست.'],
  UNAUTHENTICATED: [HttpStatus.UNAUTHORIZED, 'برای ادامه وارد حساب کاربری شوید.'],
  SESSION_EXPIRED: [HttpStatus.UNAUTHORIZED, 'نشست شما منقضی شده است؛ دوباره وارد شوید.'],
  FORBIDDEN: [HttpStatus.FORBIDDEN, 'اجازه انجام این عملیات را ندارید.'],
  NOT_FOUND: [HttpStatus.NOT_FOUND, 'مورد درخواستی پیدا نشد.'],
  CONFLICT: [HttpStatus.CONFLICT, 'این عملیات با وضعیت فعلی سازگار نیست.'],
  RATE_LIMITED: [HttpStatus.TOO_MANY_REQUESTS, 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید.'],

  TENANT_REQUIRED: [HttpStatus.BAD_REQUEST, 'سازمان مشخص نشده است.'],
  TENANT_NOT_FOUND: [HttpStatus.NOT_FOUND, 'سازمان پیدا نشد.'],
  TENANT_UNAVAILABLE: [HttpStatus.FORBIDDEN, 'دسترسی به این سازمان در حال حاضر امکان‌پذیر نیست.'],
  MEMBERSHIP_REQUIRED: [HttpStatus.FORBIDDEN, 'عضویت فعالی در این سازمان ندارید.'],

  OTP_INVALID: [HttpStatus.BAD_REQUEST, 'کد تأیید نادرست یا منقضی شده است.'],
  OTP_TOO_MANY_ATTEMPTS: [HttpStatus.TOO_MANY_REQUESTS, 'تعداد تلاش‌ها بیش از حد مجاز است؛ کد جدید دریافت کنید.'],
  OTP_RESEND_TOO_SOON: [HttpStatus.TOO_MANY_REQUESTS, 'برای دریافت کد جدید کمی صبر کنید.'],
  PROOF_INVALID: [HttpStatus.BAD_REQUEST, 'تأیید شماره موبایل معتبر نیست؛ دوباره تأیید کنید.'],
  INVALID_CREDENTIALS: [HttpStatus.UNAUTHORIZED, 'نام کاربری یا رمز عبور نادرست است.'],
  ACCOUNT_LOCKED: [HttpStatus.LOCKED, 'به دلیل تلاش‌های ناموفق، ورود موقتاً مسدود است.'],
  ACCOUNT_DISABLED: [HttpStatus.FORBIDDEN, 'حساب کاربری غیرفعال است.'],
  ACCOUNT_EXISTS: [HttpStatus.CONFLICT, 'برای این اطلاعات قبلاً حساب ساخته شده است؛ وارد شوید و درخواست عضویت ثبت کنید.'],
  WEAK_PASSWORD: [HttpStatus.BAD_REQUEST, 'رمز عبور با سیاست امنیتی سازمان سازگار نیست.'],

  MEMBERSHIP_EXISTS: [HttpStatus.CONFLICT, 'در این سازمان قبلاً درخواست عضویت ثبت کرده‌اید.'],
  MEMBER_NO_TAKEN: [HttpStatus.CONFLICT, 'این شماره دانشجویی/پرسنلی در سازمان ثبت شده است.'],
  INVALID_STATE_TRANSITION: [HttpStatus.CONFLICT, 'این اقدام در وضعیت فعلی پرونده مجاز نیست.'],
  SEPARATION_OF_DUTIES: [HttpStatus.FORBIDDEN, 'به دلیل تضاد منافع، انجام این اقدام توسط شما مجاز نیست.'],
  REVISION_DEADLINE_PASSED: [HttpStatus.CONFLICT, 'مهلت اصلاح به پایان رسیده است.'],

  UNIT_INVALID: [HttpStatus.BAD_REQUEST, 'واحد سازمانی انتخاب‌شده معتبر نیست.'],
  ROLE_PERMISSION_INVALID: [HttpStatus.BAD_REQUEST, 'یکی از مجوزهای انتخاب‌شده معتبر نیست.'],
  ROLE_READ_ONLY: [HttpStatus.FORBIDDEN, 'این نقش قالب سیستمی است و قابل ویرایش نیست؛ از آن کپی بگیرید.'],
  SCOPE_INVALID: [HttpStatus.BAD_REQUEST, 'دامنه انتساب نقش معتبر نیست.'],

  FILE_TYPE_NOT_ALLOWED: [HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'نوع فایل مجاز نیست.'],
  FILE_TOO_LARGE: [HttpStatus.PAYLOAD_TOO_LARGE, 'حجم فایل بیش از حد مجاز است.'],
  FILE_QUOTA_EXCEEDED: [HttpStatus.INSUFFICIENT_STORAGE, 'فضای ذخیره‌سازی سازمان پر شده است.'],
  FILE_NOT_READY: [HttpStatus.CONFLICT, 'فایل هنوز بررسی امنیتی نشده یا در قرنطینه است.'],
  FILE_TOKEN_INVALID: [HttpStatus.FORBIDDEN, 'لینک دانلود نامعتبر یا منقضی شده است.'],

  WORKFLOW_NOT_AVAILABLE: [HttpStatus.NOT_FOUND, 'برای این نوع درخواست فرایند فعالی تعریف نشده است.'],
  WORKFLOW_INVALID: [HttpStatus.BAD_REQUEST, 'تعریف گردش‌کار معتبر نیست؛ خطاهای اعتبارسنجی را برطرف کنید.'],
  WORKFLOW_VERSION_LOCKED: [HttpStatus.CONFLICT, 'نسخه منتشرشده قابل ویرایش نیست؛ نسخه جدید بسازید.'],
  SELECTOR_OVERLAP: [HttpStatus.CONFLICT, 'نسخه منتشرشده دیگری برای همین نوع درخواست و دامنه وجود دارد.'],
  ASSIGNEE_UNRESOLVED: [HttpStatus.BAD_REQUEST, 'مسئول این مرحله از فرایند مشخص نشد.'],
  CASE_LIMIT: [HttpStatus.CONFLICT, 'درخواست فعال دیگری از همین نوع دارید.'],
  REAPPLY_TOO_SOON: [HttpStatus.CONFLICT, 'ثبت درخواست جدید پس از رد، هنوز مجاز نیست.'],
  MEMBER_NOT_ELIGIBLE: [HttpStatus.BAD_REQUEST, 'فرد انتخاب‌شده برای این نقش مجاز نیست.'],
  MEMBER_CAPACITY_FULL: [HttpStatus.CONFLICT, 'ظرفیت فرد انتخاب‌شده تکمیل است؛ فرد دیگری را انتخاب کنید.'],
  CONFLICT_OF_INTEREST: [HttpStatus.CONFLICT, 'تضاد منافع احتمالی وجود دارد؛ پس از بررسی، آن را تأیید کنید.'],
  EVENT_REGISTRATION_CLOSED: [HttpStatus.CONFLICT, 'ثبت‌نام این رویداد باز نیست یا مهلت آن گذشته است.'],
  EVENT_NOT_ELIGIBLE: [HttpStatus.FORBIDDEN, 'شرایط ثبت‌نام در این رویداد را ندارید.'],
  FEE_NOT_DEFINED: [HttpStatus.CONFLICT, 'تعرفه این خدمت هنوز تعریف نشده است.'],
  GATEWAY_UNAVAILABLE: [HttpStatus.SERVICE_UNAVAILABLE, 'درگاه پرداخت در دسترس نیست؛ کمی بعد دوباره تلاش کنید.'],
  PAYMENT_NOT_PAYABLE: [HttpStatus.CONFLICT, 'این پرداخت در وضعیت فعلی قابل انجام نیست.'],
  PAYMENT_EXPIRED: [HttpStatus.CONFLICT, 'مهلت این پرداخت گذشته است.'],
  CALL_FOR_PAPERS_CLOSED: [HttpStatus.CONFLICT, 'فراخوان مقاله این رویداد باز نیست یا مهلت ارسال گذشته است.'],
  CALL_FOR_PAPERS_NOT_ELIGIBLE: [HttpStatus.FORBIDDEN, 'ارسال مقاله به این همایش برای گروه مشخصی است و شما در آن قرار ندارید.'],
  EVENT_FULL: [HttpStatus.CONFLICT, 'ظرفیت این رویداد تکمیل شده است.'],
  MAX_ROUNDS_REACHED: [HttpStatus.CONFLICT, 'سقف دورهای داوری این مقاله پر شده است؛ تصمیم نهایی را ثبت کنید.'],
  GUEST_LINK_INVALID: [HttpStatus.FORBIDDEN, 'لینک داوری نامعتبر، منقضی یا قبلاً استفاده شده است.'],
  CASE_STALE: [HttpStatus.CONFLICT, 'پرونده هم‌زمان توسط شخص دیگری تغییر کرد؛ صفحه را تازه کنید.'],

  INTERNAL: [HttpStatus.INTERNAL_SERVER_ERROR, 'خطای داخلی رخ داد؛ لطفاً دوباره تلاش کنید.'],
} as const satisfies Record<string, readonly [HttpStatus, string]>;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? ErrorCodes[code][1]);
    this.status = ErrorCodes[code][0];
  }
}
