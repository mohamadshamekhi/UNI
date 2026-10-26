"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, GraduationCap, MapPin, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDate, toFaDigits } from "@uni/shared/format";
import { DEGREE, THESIS_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { Thesis } from "@uni/shared/types";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

const ORDER = ["proposal", "in_progress", "defense_scheduled", "defended"] as const;

/** «پرونده تحصیلی»: the student's theses with advisor, defense and grade. */
export default function ThesisRecordPage() {
  const slug = useTenantSlug();
  const q = useQuery({ queryKey: ["my-theses", slug], queryFn: () => api<Thesis[]>("/v1/me/theses", { tenant: slug }) });
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <p className="text-sm text-white/70">پرونده تحصیلی</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">پایان‌نامه و رساله</h1>
        <p className="mt-2 max-w-xl leading-7 text-white/75">وضعیت پایان‌نامه، استادان، جلسه دفاع و نمره. با تصویب پیشنهاده، پرونده اینجا ساخته می‌شود.</p>
      </section>
      <QueryView
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={GraduationCap}
            title="هنوز پایان‌نامه‌ای ثبت نشده"
            description="پیشنهاده را از «درخواست جدید» ثبت کنید؛ پس از تصویب، پرونده تحصیلی ساخته می‌شود."
            action={
              <Link href={`/${slug}/cases/new`} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                ثبت پیشنهاده
              </Link>
            }
          />
        }
      >
        {(list) => (
          <ul className="flex flex-col gap-4">
            {list.map((t) => {
              const st = THESIS_STATUS[t.status];
              const reached = ORDER.indexOf(t.status as (typeof ORDER)[number]);
              return (
                <li key={t.id} className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{[t.degree ? (DEGREE[t.degree] ?? t.degree) : null, t.unitNameFa].filter(Boolean).join(" · ")}</p>
                      <h2 className="mt-1 text-lg font-bold">{t.titleFa}</h2>
                      {t.titleEn && <p dir="ltr" className="mt-0.5 text-start text-sm text-muted-foreground">{t.titleEn}</p>}
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>

                  {reached >= 0 && (
                    <ol aria-label="مراحل" className="mt-5 grid grid-cols-4 gap-2 text-center text-xs">
                      {ORDER.map((s, i) => (
                        <li key={s} className="flex flex-col items-center gap-1.5">
                          <span className={`h-1.5 w-full rounded-full ${i <= reached ? "bg-primary" : "bg-border"}`} />
                          <span className={i <= reached ? "font-semibold" : "text-muted-foreground"}>{THESIS_STATUS[s].label}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
                    <Item icon={UserRound} label="استاد راهنما" value={t.advisor?.fullName} />
                    <Item icon={UserRound} label="استاد مشاور" value={t.coAdvisor?.fullName} />
                    <Item icon={Users} label="داوران" value={t.reviewers.length ? t.reviewers.join("، ") : null} />
                    <Item icon={CalendarClock} label="جلسه دفاع" value={t.defenseAt ? fmtDate(t.defenseAt) : null} />
                    <Item icon={MapPin} label="محل دفاع" value={t.defensePlace} />
                  </dl>

                  {t.grade !== null && (
                    <div className="mt-6 flex items-center gap-4 rounded-2xl bg-success-bg px-5 py-4 text-success">
                      <span className="text-3xl font-black tabular">{toFaDigits(t.grade.toFixed(2))}</span>
                      <span>
                        <span className="block text-xs">نمره دفاع از ۲۰</span>
                        <span className="block font-bold">{t.gradeLabel}</span>
                      </span>
                    </div>
                  )}
                  <Link href={`/${slug}/cases/${t.caseId}`} className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    مشاهده پرونده
                    <ChevronLeft aria-hidden className="size-4" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryView>
    </div>
  );
}

function Item({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5">{value || "—"}</dd>
      </div>
    </div>
  );
}
