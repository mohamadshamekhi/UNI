import { ArrowLeft, Landmark } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { brandColor } from "@/lib/brand";

export interface UniversityItem {
  slug: string;
  nameFa: string;
  nameEn: string | null;
  branding?: { primaryColor?: string; displayName?: string } | null;
}

/** Card tinted by the university's own colour: icon tile, top light and hover glow. */
export function UniversityCard({ u }: { u: UniversityItem }) {
  const color = brandColor(u.slug, u.branding?.primaryColor);
  return (
    <div
      style={{ "--brand": color } as CSSProperties}
      className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--brand)_45%,transparent)] hover:shadow-[0_24px_48px_-20px_color-mix(in_oklab,var(--brand)_55%,transparent)] focus-within:ring-2 focus-within:ring-ring"
    >
      <span aria-hidden className="pointer-events-none absolute -top-24 -end-24 size-48 rounded-full opacity-[0.08] blur-2xl transition-opacity duration-300 group-hover:opacity-20" style={{ background: color }} />
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div className="relative flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform duration-300 group-hover:scale-105"
          style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 70%, black))`, boxShadow: `0 10px 24px -10px ${color}` }}
        >
          <Landmark className="size-7" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="text-lg leading-7 font-bold text-balance">
            <Link href={`/${u.slug}`} className="after:absolute after:inset-0 after:rounded-3xl focus:outline-none">
              {u.branding?.displayName || u.nameFa}
            </Link>
          </h3>
          {u.nameEn && (
            <p className="mt-0.5 truncate text-right text-sm text-muted-foreground" dir="ltr">
              {u.nameEn}
            </p>
          )}
        </div>
      </div>
      <div className="relative mt-auto flex items-center justify-between pt-6 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          ثبت‌نام باز است
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 font-semibold transition-colors duration-300 group-hover:bg-[var(--brand)] group-hover:text-white">
          ورود
          <ArrowLeft aria-hidden className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
        </span>
      </div>
    </div>
  );
}

export function UniversityCardSkeleton() {
  return (
    <div aria-hidden className="h-full rounded-3xl border border-border bg-card p-6">
      <div className="flex gap-4">
        <div className="size-14 animate-pulse rounded-2xl bg-muted" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="mt-8 h-7 animate-pulse rounded-full bg-muted" />
    </div>
  );
}
