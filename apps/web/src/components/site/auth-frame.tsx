"use client";

import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { usePublicTenant, useTenantSlug } from "@/lib/tenant";
import { HeroBackdrop } from "./sections";
import { TenantMark } from "./tenant-mark";

/**
 * Split card used by the portal's auth pages: the form on one side, a brand-tinted aurora panel
 * on the other (hidden below lg, where the form takes the full width).
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  aside,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** custom content for the brand panel; defaults to the university pitch */
  aside?: ReactNode;
  wide?: boolean;
}) {
  const slug = useTenantSlug();
  const tenant = usePublicTenant(slug);
  const t = tenant.data;
  const brand = t?.branding.primaryColor && /^#[0-9a-f]{6}$/i.test(t.branding.primaryColor) ? t.branding.primaryColor : undefined;
  return (
    <div
      className={`enter mx-auto grid overflow-hidden rounded-[2rem] border border-border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_30px_60px_-30px_rgb(15_23_42/0.35)] lg:grid-cols-[1fr_0.9fr] ${wide ? "max-w-6xl" : "max-w-5xl"}`}
    >
      <div className="px-5 py-8 sm:px-10 sm:py-12">
        <h1 className="text-2xl font-black tracking-tight text-balance sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm leading-7 text-muted-foreground">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
      <aside
        className="hero-band relative isolate hidden overflow-hidden p-10 lg:flex lg:flex-col"
        style={brand ? ({ "--hero-to": `color-mix(in oklab, ${brand} 75%, #06122e)` } as CSSProperties) : undefined}
      >
        <HeroBackdrop />
        {t && (
          <div className="flex items-center gap-3">
            <TenantMark slug={slug} tenant={t} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-bold">{t.branding.displayName || t.nameFa}</p>
              {t.nameEn && (
                <p className="truncate text-right text-xs text-white/60" dir="ltr">
                  {t.nameEn}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="mt-auto">{aside ?? <DefaultPitch />}</div>
      </aside>
    </div>
  );
}

function DefaultPitch() {
  return (
    <>
      <h2 className="text-3xl leading-tight font-black">
        خدمات دانشگاه،
        <br />
        <span className="text-gold-gradient">در دسترس شما.</span>
      </h2>
      <ul className="mt-6 space-y-3 text-sm text-white/80">
        {["پیگیری لحظه‌ای وضعیت درخواست‌ها", "اطلاع‌رسانی پیامکی در هر مرحله", "مدارک رمزنگاری‌شده و امن"].map((f) => (
          <li key={f} className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
              <Check aria-hidden className="size-3.5 text-gold-bright" />
            </span>
            {f}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Vertical step rail for the brand panel of multi-step flows. */
export function StepRail({ steps, current }: { steps: { title: string; hint: string }[]; current: number }) {
  return (
    <ol aria-label="مراحل ثبت‌نام" className="relative space-y-6">
      <span aria-hidden className="absolute top-4 bottom-4 start-[15px] w-px bg-white/15" />
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s.title} aria-current={state === "current" ? "step" : undefined} className="relative flex items-start gap-4">
            <span
              className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors duration-300 ${
                state === "done"
                  ? "bg-gold-bright text-[#3a2a00]"
                  : state === "current"
                    ? "bg-white text-[#0b1f52] shadow-[0_0_0_6px_rgb(255_255_255/0.12)]"
                    : "border border-white/25 bg-white/5 text-white/60"
              }`}
            >
              {state === "done" ? <Check aria-hidden className="size-4" /> : (i + 1).toLocaleString("fa-IR")}
            </span>
            <div className={state === "todo" ? "opacity-60" : ""}>
              <p className="font-semibold">{s.title}</p>
              <p className="mt-0.5 text-sm text-white/65">{s.hint}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
