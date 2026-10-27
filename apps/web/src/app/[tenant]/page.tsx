"use client";

import type React from "react";

import { toFaDigits } from "@uni/shared/format";
import { ArrowLeft, BadgeCheck, BookOpenText, CalendarDays, Check, FileSearch, GraduationCap, LogIn, Newspaper, Presentation, Smartphone, Upload, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { CountUp, Reveal } from "@/components/site/reveal";
import { Eyebrow, HeroBackdrop, HeroCurve, StatusPreview } from "@/components/site/sections";
import { CONTAINER, TenantMark } from "@/components/site/tenant-mark";
import { usePublicTenant, usePublicUnits, useSession, useTenantSlug } from "@/lib/tenant";

const STEPS = [
  { icon: GraduationCap, title: "دانشکده و گروه", text: "محل تحصیل یا خدمت خود را انتخاب کنید." },
  { icon: Smartphone, title: "تأیید موبایل", text: "کد پیامکی را وارد کنید؛ حساب شما ساخته می‌شود." },
  { icon: Upload, title: "بارگذاری مدرک", text: "کارت دانشجویی یا حکم کارگزینی را بارگذاری کنید." },
  { icon: UserRoundCheck, title: "تأیید کارشناس", text: "نتیجه بررسی با پیامک اطلاع داده می‌شود." },
];

const AUDIENCES = [
  {
    icon: GraduationCap,
    title: "دانشجویان",
    tint: "#2f6bff",
    points: ["عضویت آنلاین با کارت دانشجویی", "پیگیری پایان‌نامه و مقاله", "ثبت‌نام در رویدادها و همایش‌ها"],
  },
  {
    icon: Presentation,
    title: "استادان",
    tint: "#7c3aed",
    points: ["عضویت با حکم کارگزینی یا دعوت دانشگاه", "کارتابل هدایت دانشجویان", "داوری و نظردهی در یک محل"],
  },
];

const MODULES: Record<string, { icon: typeof BadgeCheck; title: string; text: string; tint: string; path: string }> = {
  thesis: { icon: BookOpenText, title: "پایان‌نامه و رساله", text: "ثبت پیشنهاده و پیگیری مرحله‌به‌مرحله تا دفاع.", tint: "#7c3aed", path: "thesis" },
  paper: { icon: FileSearch, title: "مقاله و داوری علمی", text: "ارسال مقاله، داوری یک‌سو یا دوسو ناشناس و پیگیری تصمیم.", tint: "#0f766e", path: "papers" },
  events: { icon: CalendarDays, title: "همایش‌ها و رویدادها", text: "مشاهده همایش‌ها و رویدادها و ثبت‌نام آنلاین.", tint: "#b45309", path: "events" },
  news: { icon: Newspaper, title: "اخبار و اطلاعیه‌ها", text: "خبرهای عمومی دانشگاه و اطلاعیه‌های ویژه گروه شما.", tint: "#2f6bff", path: "news" },
};

export default function TenantHome() {
  const slug = useTenantSlug();
  const tenant = usePublicTenant(slug);
  const units = usePublicUnits(slug);
  const session = useSession();
  const t = tenant.data;
  const name = t?.branding.displayName || t?.nameFa || "";
  const brand = t?.branding.primaryColor && /^#[0-9a-f]{6}$/i.test(t.branding.primaryColor) ? t.branding.primaryColor : undefined;
  const modules = (t?.enabledModules ?? []).filter((m) => MODULES[m]);
  const firstFaculty = units.data?.[0]?.nameFa;

  const primaryCta = session.data
    ? { href: `/${slug}/me`, label: "مشاهده وضعیت عضویت" }
    : { href: `/${slug}/register`, label: "ثبت‌نام دانشجو یا استاد" };

  return (
    <>
      {/* ============================================================ hero */}
      <section className="hero-band relative isolate overflow-hidden" style={brand ? ({ "--hero-to": `color-mix(in oklab, ${brand} 75%, #06122e)` } as CSSProperties) : undefined}>
        <HeroBackdrop />
        <div className={`${CONTAINER} grid items-center gap-14 pt-32 pb-28 lg:grid-cols-[1.1fr_1fr] lg:pt-40 lg:pb-36`}>
          <div>
            <div className="enter">
              <p className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/10 py-1.5 ps-1.5 pe-4 text-sm text-white/85 backdrop-blur">
                {t && <TenantMark slug={slug} tenant={t} size="sm" />}
                {t?.nameEn ? <span dir="ltr">{t.nameEn}</span> : "سامانه خدمات آموزشی و پژوهشی"}
              </p>
            </div>
            <div className="enter" style={{ "--d": "80ms" } as React.CSSProperties}>
              <h1 className="mt-6 text-[2.4rem] leading-[1.25] font-black tracking-tight text-balance sm:text-5xl sm:leading-[1.2]">
                سامانه خدمات
                <br />
                <span className="text-gold-gradient">{name}</span>
              </h1>
            </div>
            <div className="enter" style={{ "--d": "160ms" } as React.CSSProperties}>
              <p className="mt-6 max-w-xl text-lg leading-9 text-white/75">عضویت، پیگیری درخواست‌ها و خدمات آموزشی و پژوهشی؛ آنلاین، شفاف و بدون مراجعه حضوری.</p>
            </div>
            <div className="enter mt-9 flex flex-wrap gap-3" style={{ "--d": "240ms" } as React.CSSProperties}>
              <Link href={primaryCta.href} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 font-semibold text-[#0b1f52] shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)] transition hover:bg-gold-bright">
                {primaryCta.label}
                <ArrowLeft aria-hidden className="size-4" />
              </Link>
              {!session.data && (
                <Link href={`/${slug}/login`} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-7 font-semibold text-white transition hover:bg-white/10">
                  <LogIn aria-hidden className="size-4" />
                  ورود به حساب
                </Link>
              )}
            </div>
            <div className="enter" style={{ "--d": "320ms" } as React.CSSProperties}>
              <dl className="mt-10 grid max-w-xl grid-cols-3 divide-x divide-x-reverse divide-white/15 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                {[
                  units.data && units.data.length === 0
                    ? { label: "گام تا عضویت", value: "۴" }
                    : { label: "دانشکده و مرکز", value: units.data ? <CountUp value={units.data.length} /> : "…" },
                  { label: "ثبت‌نام آنلاین", value: "۱۰۰٪" },
                  { label: "پیگیری لحظه‌ای", value: "۲۴/۷" },
                ].map((s) => (
                  <div key={s.label} className="px-4 py-4 text-center">
                    <dd className="text-2xl font-extrabold sm:text-3xl">{s.value}</dd>
                    <dt className="mt-1 text-xs text-white/65 sm:text-sm">{s.label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <StatusPreview unitLabel={firstFaculty ? `کارشناسی ارشد · ${firstFaculty}` : undefined} />
        </div>
        <HeroCurve />
      </section>

      {/* ============================================================ audiences */}
      <section aria-labelledby="who-title" className={`${CONTAINER} py-20`}>
        <Reveal>
          <Eyebrow>دانشجو و استاد</Eyebrow>
          <h2 id="who-title" className="mt-3 text-3xl font-black sm:text-4xl">برای چه کسانی؟</h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 100}>
              <div className="group h-full rounded-3xl border border-border bg-card p-7 transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgb(15_23_42/0.35)]">
                <span className="flex size-14 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${a.tint}, color-mix(in oklab, ${a.tint} 65%, black))` }}>
                  <a.icon aria-hidden className="size-7" strokeWidth={1.6} />
                </span>
                <h3 className="mt-6 text-xl font-bold">{a.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {a.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm leading-6 text-muted-foreground">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================================================ steps */}
      <section id="steps" aria-labelledby="steps-title" className="scroll-mt-24 bg-card/60">
        <div className={`${CONTAINER} py-20`}>
          <Reveal className="text-center">
            <Eyebrow>کمتر از پنج دقیقه</Eyebrow>
            <h2 id="steps-title" className="mt-3 text-3xl font-black sm:text-4xl">ثبت‌نام در چهار گام ساده</h2>
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
      <section aria-labelledby="services-title" className={`${CONTAINER} py-20`}>
        <Reveal>
          <Eyebrow>خدمات این دانشگاه</Eyebrow>
          <h2 id="services-title" className="mt-3 text-3xl font-black sm:text-4xl">چه کارهایی را می‌توانید آنلاین انجام دهید؟</h2>
        </Reveal>
        <ul className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Reveal as="li" className={modules.length === 0 ? "md:col-span-2 lg:col-span-3" : ""}>
            <div className="hero-band relative h-full overflow-hidden rounded-3xl p-7">
              <span aria-hidden className="aurora aurora-1 -top-20 -end-16 size-64" />
              <div className="relative flex items-center justify-between">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                  <BadgeCheck aria-hidden className="size-6" strokeWidth={1.7} />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-sm font-medium text-emerald-200">
                  <Check aria-hidden className="size-4" />
                  فعال
                </span>
              </div>
              <h3 className="relative mt-6 text-lg font-bold">عضویت و احراز هویت</h3>
              <p className="relative mt-2 max-w-2xl text-sm leading-7 text-white/75">ثبت‌نام آنلاین، بررسی مدارک توسط کارشناس و فعال‌شدن دسترسی‌ها با اطلاع‌رسانی پیامکی.</p>
              {modules.length === 0 && (
                <ul className="relative mt-6 flex flex-wrap gap-2 text-sm">
                  {["تأیید پیامکی", "بارگذاری امن مدارک", "پیگیری مرحله‌ای", "اصلاح آنلاین"].map((f) => (
                    <li key={f} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-white/90">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Reveal>
          {modules.map((m, i) => {
            const mod = MODULES[m]!;
            return (
              <Reveal as="li" key={m} delay={(i + 1) * 80}>
                <Link href={`/${slug}/${mod.path}`} className="group block h-full rounded-3xl border border-border bg-card p-7 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
                  <div className="flex items-center justify-between">
                    <span className="flex size-12 items-center justify-center rounded-2xl text-white" style={{ background: `linear-gradient(135deg, ${mod.tint}, color-mix(in oklab, ${mod.tint} 65%, black))` }}>
                      <mod.icon aria-hidden className="size-6" strokeWidth={1.7} />
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success">
                      <Check aria-hidden className="size-3.5" />
                      فعال
                    </span>
                  </div>
                  <h3 className="mt-6 text-lg font-bold group-hover:text-primary">{mod.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{mod.text}</p>
                </Link>
              </Reveal>
            );
          })}
        </ul>
      </section>

      {/* ============================================================ closing CTA */}
      <section aria-labelledby="cta-title" className={`${CONTAINER} pb-20`}>
        <Reveal
          className="hero-band relative isolate overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-12 sm:py-16"
        >
          <div aria-hidden className="absolute inset-0 -z-10">
            <span className="aurora aurora-2 -top-32 start-1/4 size-96" />
            <span className="aurora aurora-3 -bottom-32 end-1/4 size-80" />
            <div className="grid-lines absolute inset-0" />
          </div>
          <h2 id="cta-title" className="text-3xl font-black text-balance sm:text-4xl">
            {session.data ? "درخواست شما در جریان است" : <>آماده‌اید؟ <span className="text-gold-gradient">همین حالا ثبت‌نام کنید.</span></>}
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-8 text-white/75">
            {session.data ? "وضعیت عضویت و هر اقدام لازم را از صفحه «وضعیت من» دنبال کنید." : "در چند دقیقه درخواست عضویت ثبت کنید؛ نتیجه با پیامک به شما اطلاع داده می‌شود."}
          </p>
          <Link href={primaryCta.href} className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 font-semibold text-[#0b1f52] transition hover:bg-gold-bright">
            {primaryCta.label}
            <ArrowLeft aria-hidden className="size-4" />
          </Link>
        </Reveal>
      </section>
    </>
  );
}
