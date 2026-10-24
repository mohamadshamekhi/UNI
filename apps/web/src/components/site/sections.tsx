import { Check, Landmark, Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/** Gold kicker line above section titles. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm font-semibold text-gold">
      <span aria-hidden className="h-px w-6 bg-gold" />
      {children}
    </p>
  );
}

/** Aurora lights + grid for the deep-navy hero band. */
export function HeroBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      <span className="aurora aurora-1 top-[-10%] end-[-5%] size-[38rem]" />
      <span className="aurora aurora-2 bottom-[-20%] start-[10%] size-[32rem]" />
      <span className="aurora aurora-3 top-[20%] start-[-8%] size-[22rem]" />
      <div className="grid-lines absolute inset-0" />
    </div>
  );
}

/** Soft curve from the hero band into the page background. */
export function HeroCurve() {
  return (
    <svg aria-hidden viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute inset-x-0 -bottom-px h-14 w-full text-background sm:h-20">
      <path d="M0 80V40C240 0 480 0 720 20S1200 60 1440 20V80Z" fill="currentColor" />
    </svg>
  );
}

/** Decorative preview of the applicant status screen. Fixed light palette (it sits on the dark hero). */
export function StatusPreview({ unitLabel = "کارشناسی ارشد · دانشکده فنی" }: { unitLabel?: string } = {}) {
  const rows = [
    { label: "ثبت درخواست", meta: "۱۴۰۵/۰۸/۰۲ · ۱۰:۲۴", state: "done" },
    { label: "بررسی مدارک توسط کارشناس", meta: "در حال انجام", state: "current" },
    { label: "فعال‌شدن عضویت", meta: "پس از تأیید", state: "todo" },
  ] as const;
  return (
    <div aria-hidden className="relative mx-auto hidden w-full max-w-md lg:block">
      <div className="float-slow">
        <div className="rotate-[-2deg] rounded-3xl border border-white/30 bg-white/95 p-7 text-slate-900 shadow-[0_40px_80px_-24px_rgb(0_0_0/0.55)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2f6bff] to-[#1e3a8a] text-white">
                <Landmark className="size-5" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-sm font-bold">وضعیت عضویت</p>
                <p className="text-xs text-slate-500">{unitLabel}</p>
              </div>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">در انتظار بررسی</span>
          </div>
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/2 rounded-full bg-gradient-to-l from-[#2f6bff] to-[#e0b44c]" />
          </div>
          <ol className="mt-6 space-y-5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                    r.state === "done" ? "bg-emerald-500 text-white" : r.state === "current" ? "border-2 border-blue-600 bg-white" : "border-2 border-slate-200 bg-white"
                  }`}
                >
                  {r.state === "done" && <Check className="size-4" />}
                  {r.state === "current" && <span className="size-2.5 animate-pulse rounded-full bg-blue-600" />}
                </span>
                <div className="flex-1">
                  <p className={`text-sm ${r.state === "todo" ? "text-slate-400" : "font-semibold"}`}>{r.label}</p>
                  <p className="text-xs text-slate-500">{r.meta}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
            <Lock className="size-4 shrink-0 text-slate-400" />
            مدارک شما رمزنگاری‌شده و فقط برای کارشناس مجاز قابل مشاهده است.
          </div>
        </div>
      </div>
      <div className="absolute -bottom-8 -start-10 flex rotate-[3deg] items-center gap-3 rounded-2xl border border-white/40 bg-white px-4 py-3 text-slate-900 shadow-2xl">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Check className="size-5" />
        </span>
        <div>
          <p className="text-sm font-bold">شماره موبایل تأیید شد</p>
          <p className="text-xs text-slate-500">کد ۶ رقمی · همین حالا</p>
        </div>
      </div>
      <div className="absolute -top-6 -end-6 flex rotate-[4deg] items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white backdrop-blur-md">
        <Sparkles className="size-4 text-gold-bright" />
        بدون مراجعه حضوری
      </div>
    </div>
  );
}
