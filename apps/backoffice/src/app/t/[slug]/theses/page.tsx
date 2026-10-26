"use client";

import { useQuery } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum, toFaDigits } from "@uni/shared/format";
import { DEGREE, THESIS_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { Thesis } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

const PAGE = 25;

/** Theses of the units the user may see (پرونده‌های تحصیلی). */
function ThesesInner() {
  const slug = useSlug();
  const router = useRouter();
  const sp = useSearchParams();
  const status = sp.get("status") ?? "";
  const offset = Number(sp.get("offset") ?? 0);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("offset" in patch)) next.delete("offset");
    router.replace(`?${next.toString()}`);
  };
  const list = useQuery({
    queryKey: ["theses", slug, status, sp.get("q"), offset],
    queryFn: () => api<{ items: Thesis[]; total: number }>("/v1/admin/theses", { tenant: slug, query: { status: status || undefined, q: sp.get("q") || undefined, limit: PAGE, offset } }),
  });
  return (
    <>
      <PageHeader eyebrow="فرایندها" title="پایان‌نامه‌ها" description="پرونده تحصیلی پایان‌نامه‌ها: استادان، داوران، جلسه دفاع و نمره." />
      <form
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ q });
        }}
      >
        <Field label="وضعیت">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setParam({ status: e.target.value })}>
              <option value="">همه</option>
              {Object.entries(THESIS_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="جست‌وجو" className="lg:col-span-2">
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} placeholder="عنوان یا نام دانشجو" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button type="submit" variant="secondary">جست‌وجو</Button>
            </div>
          )}
        </Field>
      </form>
      <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={GraduationCap} title="پایان‌نامه‌ای با این فیلترها نیست" />}>
        {(d) => (
          <>
            <p className="mb-2 text-sm text-muted-foreground tabular">{fmtNum(d.total)} پایان‌نامه</p>
            <Table caption="فهرست پایان‌نامه‌ها">
              <thead>
                <tr>
                  <Th>عنوان</Th>
                  <Th>دانشجو</Th>
                  <Th>استاد راهنما</Th>
                  <Th>وضعیت</Th>
                  <Th>دفاع</Th>
                  <Th>نمره</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/60">
                    <Td>
                      <Link href={`/t/${slug}/cases/${t.caseId}`} className="font-medium text-primary hover:underline">{t.titleFa}</Link>
                      <span className="block text-xs text-muted-foreground">{[t.degree ? (DEGREE[t.degree] ?? t.degree) : null, t.unitNameFa].filter(Boolean).join(" · ")}</span>
                    </Td>
                    <Td>
                      {t.student.fullName}
                      {t.student.memberNo && <span className="block text-xs text-muted-foreground tabular">{toFaDigits(t.student.memberNo)}</span>}
                    </Td>
                    <Td>{t.advisor?.fullName ?? "—"}</Td>
                    <Td><Badge tone={THESIS_STATUS[t.status].tone}>{THESIS_STATUS[t.status].label}</Badge></Td>
                    <Td className="tabular whitespace-nowrap">{t.defenseAt ? fmtDate(t.defenseAt) : "—"}</Td>
                    <Td className="tabular">{t.grade !== null ? `${toFaDigits(t.grade.toFixed(2))} · ${t.gradeLabel}` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <nav aria-label="صفحه‌بندی" className="mt-3 flex items-center justify-between">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setParam({ offset: String(Math.max(0, offset - PAGE)) })}>قبلی</Button>
              <span className="text-xs text-muted-foreground tabular">{fmtNum(offset + 1)}–{fmtNum(Math.min(offset + PAGE, d.total))} از {fmtNum(d.total)}</span>
              <Button size="sm" variant="secondary" disabled={offset + PAGE >= d.total} onClick={() => setParam({ offset: String(offset + PAGE) })}>بعدی</Button>
            </nav>
          </>
        )}
      </QueryView>
    </>
  );
}

export default function ThesesPage() {
  return (
    <Suspense>
      <ThesesInner />
    </Suspense>
  );
}
