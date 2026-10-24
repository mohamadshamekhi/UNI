"use client";

import { ArrowLeft, BadgeCheck, Landmark, BookOpenText, CalendarDays, FileSearch, GraduationCap, LogIn, Presentation, Smartphone, Upload, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Reveal } from "@/components/site/reveal";
import { toFaDigits } from "@uni/shared/format";
import { usePublicTenant, useSession, useTenantSlug } from "@/lib/tenant";

const STEPS = [
  { icon: GraduationCap, title: "دانشکده و گروه", text: "محل تحصیل یا خدمت خود را انتخاب کنید." },
  { icon: Smartphone, title: "تأیید موبایل", text: "کد پیامکی را وارد کنید." },
  { icon: Upload, title: "بارگذاری مدرک", text: "کارت دانشجویی یا حکم کارگزینی." },
  { icon: UserRoundCheck, title: "تأیید کارشناس", text: "نتیجه با پیامک اطلاع داده می‌شود." },
];

const MODULES: Record<string, { icon: typeof BadgeCheck; title: string }> = {
  thesis: { icon: BookOpenText, title: "پایان‌نامه و رساله" },
  paper: { icon: FileSearch, title: "مقاله و داوری علمی" },
  events: { icon: CalendarDays, title: "همایش‌ها و رویدادها" },
};

export default function TenantHome() {
  const slug = useTenantSlug();
  const tenant = usePublicTenant(slug);
  const session = useSession();
  const t = tenant.data;
  const name = t?.branding.displayName || t?.nameFa;
  const modules = (t?.enabledModules ?? []).filter((m) => MODULES[m]);
  const brand = t?.branding.primaryColor && /^#[0-9a-f]{6}$/i.test(t.branding.primaryColor) ? t.branding.primaryColor : undefined;

  return (
    <div className="flex flex-col gap-14 py-4">
      <section
        className="hero-band relative isolate overflow-hidden rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16"
        style={brand ? ({ "--hero-to": `color-mix(in oklab, ${brand} 75%, #06122e)` } as CSSProperties) : undefined}
      >
        <div aria-hidden className="absolute inset-0 -z-10">
          <span className="aurora aurora-1 -top-32 -end-20 size-[28rem]" />
          <span className="aurora aurora-3 -bottom-32 start-[-5%] size-80" />
          <div className="grid-lines absolute inset-0" />
        </div>
        <div className="max-w-2xl">
          <Reveal>
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
              <Landmark aria-hidden className="size-7" strokeWidth={1.6} />
            </span>
          </Reveal>
          {t?.nameEn && (
            <Reveal delay={60}>
              <p className="mt-6 text-right text-sm text-white/65" dir="ltr">
                {t.nameEn}
              </p>
            </Reveal>
          )}
          <Reveal delay={120}>
            <h1 className="mt-2 text-3xl leading-tight font-black text-balance sm:text-5xl sm:leading-tight">
              سامانه خدمات <span className="text-gold-gradient">{name}</span>
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="mt-5 text-lg leading-9 text-white/75">عضویت، پیگیری درخواست‌ها و خدمات آموزشی و پژوهشی؛ آنلاین و بدون مراجعه حضوری.</p>
          </Reveal>
          <Reveal delay={240} className="mt-9 flex flex-wrap gap-3">
            {session.data ? (
              <Link href={`/${slug}/me`} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 font-semibold text-[#0b1f52] transition hover:bg-gold-bright">
                مشاهده وضعیت عضویت
                <ArrowLeft aria-hidden className="size-4" />
              </Link>
            ) : (
              <>
                <Link href={`/${slug}/register`} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 font-semibold text-[#0b1f52] transition hover:bg-gold-bright">
                  ثبت‌نام دانشجو یا استاد
                  <ArrowLeft aria-hidden className="size-4" />
                </Link>
                <Link href={`/${slug}/login`} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-7 font-semibold text-white transition hover:bg-white/10">
                  <LogIn aria-hidden className="size-4" />
                  ورود به حساب
                </Link>
              </>
            )}
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="who">
        <h2 id="who" className="text-xl font-bold sm:text-2xl">برای چه کسانی؟</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            { icon: GraduationCap, title: "دانشجویان", text: "عضویت با کارت دانشجویی، سپس پیگیری پایان‌نامه، مقاله و ثبت‌نام در رویدادها." },
            { icon: Presentation, title: "استادان", text: "عضویت با حکم کارگزینی؛ کارتابل هدایت دانشجویان، داوری و نظردهی." },
          ].map((c) => (
            <div key={c.title} className="flex gap-4 rounded-3xl border border-border bg-card p-6 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-24px_rgb(15_23_42/0.35)]">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-info-bg text-primary">
                <c.icon aria-hidden className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="steps">
        <h2 id="steps" className="text-xl font-bold sm:text-2xl">مراحل ثبت‌نام</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-full bg-info-bg text-primary">
                  <s.icon aria-hidden className="size-5" />
                </span>
                <span className="text-3xl font-black text-gold/40 tabular" aria-hidden>
                  {toFaDigits(String(i + 1))}
                </span>
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {modules.length > 0 && (
        <section aria-labelledby="modules">
          <h2 id="modules" className="text-xl font-bold sm:text-2xl">خدمات فعال این دانشگاه</h2>
          <ul className="mt-6 flex flex-wrap gap-3">
            {modules.map((m) => {
              const mod = MODULES[m]!;
              return (
                <li key={m} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm">
                  <mod.icon aria-hidden className="size-4 text-primary" />
                  {mod.title}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
