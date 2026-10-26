"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, GraduationCap, Users } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum, toFaDigits } from "@uni/shared/format";
import { DEGREE, MY_ROLE, THESIS_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { PageHeader } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { Thesis } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

/** Theses the user supervises, co-supervises or reviews (دانشجویان من). */
export default function SupervisionsPage() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["supervisions", slug], queryFn: () => api<Thesis[]>("/v1/me/supervisions", { tenant: slug }) });
  return (
    <>
      <PageHeader eyebrow="کار من" title="دانشجویان من" description="پایان‌نامه‌هایی که راهنما، مشاور یا داور آن هستید." />
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Users} title="فعلاً دانشجویی ندارید" description="پس از تصویب پیشنهاده‌ای که راهنمای آن هستید، اینجا نمایش داده می‌شود." />}>
        {(list) => {
          const active = list.filter((t) => t.myRole === "advisor" && (t.status === "in_progress" || t.status === "defense_scheduled")).length;
          return (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                راهنمایی فعال: <span className="font-semibold tabular text-foreground">{fmtNum(active)}</span>
              </p>
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((t) => (
                  <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gold">{MY_ROLE[t.myRole ?? "reviewer"]}</p>
                        <Link href={`/t/${slug}/cases/${t.caseId}`} className="mt-0.5 block font-bold text-primary hover:underline">{t.titleFa}</Link>
                      </div>
                      <Badge tone={THESIS_STATUS[t.status].tone}>{THESIS_STATUS[t.status].label}</Badge>
                    </div>
                    <p className="flex items-center gap-2 text-sm">
                      <GraduationCap aria-hidden className="size-4 text-primary" />
                      {t.student.fullName}
                      {t.degree && <span className="text-muted-foreground">· {DEGREE[t.degree] ?? t.degree}</span>}
                    </p>
                    {(t.defenseAt || t.grade !== null) && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarClock aria-hidden className="size-4" />
                        {t.defenseAt ? `دفاع: ${fmtDate(t.defenseAt)}` : ""}
                        {t.grade !== null ? ` · نمره ${toFaDigits(t.grade.toFixed(2))} (${t.gradeLabel})` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
