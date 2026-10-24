"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@uni/shared/api";
import { toFaDigits } from "@uni/shared/format";
import { ErrorState } from "@uni/shared/ui/states";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpenText,
  CalendarDays,
  Check,
  CircleDashed,
  CreditCard,
  FileSearch,
  GraduationCap,
  Landmark,
  Lock,
  Megaphone,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { CountUp, Reveal } from "@/components/site/reveal";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";
import { UniversityCard, UniversityCardSkeleton, type UniversityItem } from "@/components/site/university-card";

const BACKOFFICE_URL = process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "/";

// search ignores Arabic/Persian letter variants (UX-03)
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌\s]+/g, " ")
    .trim();

const STEPS = [
  { icon: GraduationCap, title: "انتخاب دانشگاه", text: "دانشگاه، دانشکده و گروه خود را انتخاب کنید." },
  { icon: Smartphone, title: "تأیید موبایل", text: "کد پیامکی را وارد کنید؛ حساب شما ساخته می‌شود." },
  { icon: Upload, title: "بارگذاری مدرک", text: "تصویر کارت دانشجویی یا حکم را بارگذاری کنید." },
  { icon: UserRoundCheck, title: "تأیید کارشناس", text: "نتیجه بررسی با پیامک به شما اطلاع داده می‌شود." },
];

const SERVICES = [
  { icon: BookOpenText, title: "پایان‌نامه و رساله", text: "ثبت پیشنهاده، انتخاب استاد راهنما و پیگیری مرحله‌به‌مرحله تا دفاع.", tint: "#7c3aed" },
  { icon: FileSearch, title: "مقاله و داوری علمی", text: "ارسال مقاله با داوری یک‌سو یا دوسو ناشناس و مدیریت نسخه‌ها.", tint: "#0f766e" },
  { icon: CalendarDays, title: "همایش‌ها و رویدادها", text: "اطلاعات رویداد، ثبت‌نام شرکت‌کنندگان و ارسال مقاله به همایش.", tint: "#b45309" },
  { icon: Megaphone, title: "اخبار و اطلاعیه‌ها", text: "اطلاع‌رسانی هدفمند برای دانشکده، گروه یا مخاطبان مشخص.", tint: "#be123c" },
  { icon: CreditCard, title: "پرداخت آنلاین", text: "پرداخت امن هزینه خدمات و رویدادها با رسید قابل پیگیری.", tint: "#0369a1" },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm font-semibold text-gold">
      <span aria-hidden className="h-px w-6 bg-gold" />
      {children}
    </p>
  );
}

export default function Home() {
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q);
  const tenants = useQuery({ queryKey: ["public-tenants"], queryFn: () => api<UniversityItem[]>("/v1/public/tenants", { public: true }) });
  const list = useMemo(() => {
    const term = norm(deferred);
    if (!term) return tenants.data ?? [];
    return (tenants.data ?? []).filter((t) => norm(`${t.nameFa} ${t.nameEn ?? ""} ${t.slug}`).includes(term));
  }, [tenants.data, deferred]);

  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* ============================================================ hero */}
        <section className="hero-band relative isolate overflow-hidden">
          <div aria-hidden className="absolute inset-0 -z-10">
            <span className="aurora aurora-1 top-[-10%] end-[-5%] size-[38rem]" />
            <span className="aurora aurora-2 bottom-[-20%] start-[10%] size-[32rem]" />
            <span className="aurora aurora-3 top-[20%] start-[-8%] size-[22rem]" />
            <div className="grid-lines absolute inset-0" />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-32 pb-28 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-40 lg:pb-36">
            <div>
              <Reveal>
                <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-white/85 backdrop-blur">
                  <Sparkles aria-hidden className="size-4 text-gold-bright" />
                  سامانه یکپارچه خدمات آموزشی و پژوهشی
                </p>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="mt-6 text-[2.6rem] leading-[1.2] font-black tracking-tight text-balance sm:text-6xl sm:leading-[1.15]">
                  از ثبت‌نام تا دفاع،
                  <br />
                  <span className="text-gold-gradient">همه در یک سامانه.</span>
                </h1>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-6 max-w-xl text-lg leading-9 text-white/75">
                  دانشگاه خود را پیدا کنید، آنلاین عضو شوید و مسیر درخواست‌هایتان را لحظه‌به‌لحظه ببینید؛ بدون نامه‌نگاری، بدون صف و مراجعه حضوری.
                </p>
              </Reveal>

              <Reveal delay={240}>
                <form
                  role="search"
                  className="mt-9 max-w-xl"
                  onSubmit={(e) => {
                    e.preventDefault();
                    document.getElementById("universities")?.scrollIntoView();
                  }}
                >
                  <label htmlFor="uni-search" className="sr-only">جست‌وجوی دانشگاه</label>
                  <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 p-1.5 ps-5 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)] backdrop-blur-xl transition-colors focus-within:border-white/50 focus-within:bg-white/15">
                    <Search aria-hidden className="size-5 shrink-0 text-white/70" />
                    <input
                      id="uni-search"
                      type="search"
                      autoComplete="off"
                      placeholder="نام دانشگاه یا مؤسسه را بنویسید…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="h-12 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/60"
                    />
                    <button type="submit" className="h-12 shrink-0 cursor-pointer rounded-full bg-white px-6 font-semibold text-[#0b1f52] transition hover:bg-gold-bright">
                      جست‌وجو
                    </button>
                  </div>
                </form>
              </Reveal>

              <Reveal delay={320}>
                <dl className="mt-10 grid max-w-xl grid-cols-3 divide-x divide-x-reverse divide-white/15 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                  {[
                    { label: "دانشگاه و مؤسسه", value: tenants.data ? <CountUp value={tenants.data.length} /> : "…" },
                    { label: "ثبت‌نام آنلاین", value: "۱۰۰٪" },
                    { label: "دسترسی همیشگی", value: "۲۴/۷" },
                  ].map((s) => (
                    <div key={s.label} className="px-4 py-4 text-center">
                      <dd className="text-2xl font-extrabold sm:text-3xl">{s.value}</dd>
                      <dt className="mt-1 text-xs text-white/65 sm:text-sm">{s.label}</dt>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            <StatusPreview />
          </div>

          {/* soft curve into the page */}
          <svg aria-hidden viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute inset-x-0 -bottom-px h-14 w-full text-background sm:h-20">
            <path d="M0 80V40C240 0 480 0 720 20S1200 60 1440 20V80Z" fill="currentColor" />
          </svg>
        </section>

        {/* ============================================================ directory */}
        <section id="universities" aria-labelledby="universities-title" className="scroll-mt-24">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Reveal className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Eyebrow>دانشگاه‌های عضو</Eyebrow>
                <h2 id="universities-title" className="mt-3 text-3xl font-black sm:text-4xl">دانشگاه خود را انتخاب کنید</h2>
                <p className="mt-3 max-w-xl text-muted-foreground">ثبت‌نام، ورود و پیگیری همه درخواست‌ها از صفحه اختصاصی هر دانشگاه انجام می‌شود.</p>
              </div>
              <div className="w-full sm:w-80">
                <label htmlFor="uni-filter" className="sr-only">فیلتر دانشگاه‌ها</label>
                <div className="flex h-12 items-center gap-2 rounded-full border border-border bg-card px-4 focus-within:border-primary">
                  <Search aria-hidden className="size-4 text-muted-foreground" />
                  <input id="uni-filter" type="search" placeholder="فیلتر بر اساس نام…" value={q} onChange={(e) => setQ(e.target.value)} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                  {q && (
                    <button type="button" aria-label="پاک کردن جست‌وجو" onClick={() => setQ("")} className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-muted">
                      <X aria-hidden className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </Reveal>

            {q && (
              <p role="status" className="mt-6 text-sm text-muted-foreground">
                {toFaDigits(String(list.length))} نتیجه برای «{q}»
              </p>
            )}

            <div className="mt-10">
              {tenants.error ? (
                <ErrorState error={tenants.error} onRetry={() => tenants.refetch()} />
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {tenants.isPending
                    ? Array.from({ length: 6 }, (_, i) => (
                        <li key={i}>
                          <UniversityCardSkeleton />
                        </li>
                      ))
                    : list.map((u, i) => (
                        <Reveal as="li" key={u.slug} delay={Math.min(i, 6) * 70}>
                          <UniversityCard u={u} />
                        </Reveal>
                      ))}
                </ul>
              )}
              {!tenants.isPending && !tenants.error && list.length === 0 && (
                <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-14 text-center">
                  <Landmark aria-hidden className="mx-auto size-10 text-muted-foreground" strokeWidth={1.5} />
                  <p className="mt-3 font-semibold">{q ? "دانشگاهی با این نام پیدا نشد" : "هنوز دانشگاهی فعال نشده است"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{q ? "املای نام را بررسی کنید یا بخشی از نام را جست‌وجو کنید." : "به‌زودی دانشگاه‌ها در این فهرست قرار می‌گیرند."}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ============================================================ how it works */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-24 bg-card/60">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Reveal className="text-center">
              <Eyebrow>کمتر از پنج دقیقه</Eyebrow>
              <h2 id="how-title" className="mt-3 text-3xl font-black sm:text-4xl">ثبت‌نام در چهار گام ساده</h2>
            </Reveal>
            <ol className="relative mt-14 grid gap-10 md:grid-cols-4 md:gap-6">
              <span aria-hidden className="absolute inset-x-[12.5%] top-8 hidden h-0.5 rounded-full bg-gradient-to-l from-primary/10 via-primary/50 to-gold/60 md:block" />
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.title} delay={i * 110} className="relative flex gap-5 md:flex-col md:items-center md:text-center">
                  <span className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-[0_12px_30px_-14px_rgb(30_64_175/0.45)]">
                    <s.icon aria-hidden className="size-7" strokeWidth={1.6} />
                    <span className="absolute -top-2 -end-2 flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#f6dd9a] to-[#c9932a] text-xs font-black text-[#3a2a00] shadow">
                      {toFaDigits(String(i + 1))}
                    </span>
                  </span>
                  <div>
                    <h3 className="text-lg font-bold">{s.title}</h3>
                    <p className="mt-1.5 text-sm leading-7 text-muted-foreground">{s.text}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ============================================================ services */}
        <section id="services" aria-labelledby="services-title" className="scroll-mt-24">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Reveal>
              <Eyebrow>یک سامانه، همه فرایندها</Eyebrow>
              <h2 id="services-title" className="mt-3 text-3xl font-black sm:text-4xl">خدمات سامانه</h2>
              <p className="mt-3 max-w-2xl text-muted-foreground">هر دانشگاه فرایندهای خود را با قواعد خودش تعریف می‌کند؛ شما همه را از یک جا پیگیری می‌کنید.</p>
            </Reveal>

            <ul className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <Reveal as="li" className="md:col-span-2 lg:row-span-2">
                <div className="hero-band relative flex h-full flex-col overflow-hidden rounded-3xl p-8">
                  <span aria-hidden className="aurora aurora-1 -top-24 -end-16 size-72" />
                  <span aria-hidden className="aurora aurora-3 -bottom-24 start-0 size-56" />
                  <div className="relative flex items-center justify-between">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                      <BadgeCheck aria-hidden className="size-7" strokeWidth={1.6} />
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-sm font-medium text-emerald-200">
                      <Check aria-hidden className="size-4" />
                      فعال
                    </span>
                  </div>
                  <h3 className="relative mt-8 text-2xl font-black">عضویت و احراز هویت</h3>
                  <p className="relative mt-3 max-w-md leading-8 text-white/75">ثبت‌نام آنلاین با تأیید موبایل، بررسی مدارک توسط کارشناس دانشگاه و فعال‌شدن خودکار دسترسی‌ها؛ با اطلاع‌رسانی پیامکی در هر مرحله.</p>
                  <ul className="relative mt-auto flex flex-wrap gap-2 pt-8 text-sm">
                    {["تأیید پیامکی", "بارگذاری امن مدارک", "پیگیری مرحله‌ای", "اصلاح آنلاین"].map((f) => (
                      <li key={f} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-white/90">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              {SERVICES.map((s, i) => (
                <Reveal as="li" key={s.title} delay={(i % 3) * 80}>
                  <div className="group h-full rounded-3xl border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-24px_rgb(15_23_42/0.35)]">
                    <div className="flex items-center justify-between">
                      <span
                        className="flex size-12 items-center justify-center rounded-2xl text-white"
                        style={{ background: `linear-gradient(135deg, ${s.tint}, color-mix(in oklab, ${s.tint} 65%, black))` }}
                      >
                        <s.icon aria-hidden className="size-6" strokeWidth={1.7} />
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        <CircleDashed aria-hidden className="size-3.5" />
                        به‌زودی
                      </span>
                    </div>
                    <h3 className="mt-6 text-lg font-bold">{s.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">{s.text}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ============================================================ closing CTA */}
        <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6">
          <Reveal className="hero-band relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-12 sm:py-16">
            <div aria-hidden className="absolute inset-0 -z-10">
              <span className="aurora aurora-2 -top-32 start-1/4 size-96" />
              <span className="aurora aurora-3 -bottom-32 end-1/4 size-80" />
              <div className="grid-lines absolute inset-0" />
            </div>
            <h2 id="cta-title" className="text-3xl font-black text-balance sm:text-4xl">
              آماده‌اید؟ <span className="text-gold-gradient">همین حالا شروع کنید.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-8 text-white/75">دانشگاه خود را انتخاب کنید و در چند دقیقه درخواست عضویت ثبت کنید. مدیران دانشگاه از پنل مدیریت وارد شوند.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href="#universities" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 font-semibold text-[#0b1f52] transition hover:bg-gold-bright">
                انتخاب دانشگاه
                <ArrowLeft aria-hidden className="size-4" />
              </a>
              <a href={BACKOFFICE_URL} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-7 font-semibold text-white transition hover:bg-white/10">
                <ShieldCheck aria-hidden className="size-4" />
                ورود مدیران دانشگاه
              </a>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Decorative preview of the applicant status screen. Fixed light palette (it sits on the dark hero). */
function StatusPreview() {
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
                <p className="text-xs text-slate-500">کارشناسی ارشد · دانشکده فنی</p>
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
