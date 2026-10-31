"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum, toFaDigits } from "@uni/shared/format";
import { PAPER_STATUS, REVIEW_MODE } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { PaperStatus, ReviewMode } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

interface Row {
  id: string;
  tracking_code: string;
  title: string;
  status: PaperStatus;
  round: number;
  review_mode: ReviewMode;
  submitted_at: string;
  updated_at: string;
  track_name: string;
  event_title: string | null;
  author_name: string;
  reviews_in: number;
  reviews_total: number;
}

const PAGE = 25;

/** Review manager's paper list (PAP-02..06). */
function PapersInner() {
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
    queryKey: ["papers", slug, status, sp.get("q"), sp.get("event"), offset],
    queryFn: () =>
      api<{ items: Row[]; total: number }>("/v1/admin/papers", { tenant: slug, query: { status: status || undefined, q: sp.get("q") || undefined, eventId: sp.get("event") || undefined, limit: PAGE, offset } }),
  });
  return (
    <>
      <PageHeader
        eyebrow="پژوهش"
        title="مقالات"
        description="بررسی اولیه، تخصیص داور، جمع‌بندی نظرها و تصمیم نهایی."
        actions={
          <Link href={`/t/${slug}/paper-tracks`} className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
            روندهای ارسال
          </Link>
        }
      />
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
              {Object.entries(PAPER_STATUS)
                .filter(([k]) => k !== "draft")
                .map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="جست‌وجو" className="lg:col-span-2">
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} placeholder="عنوان یا شناسه پیگیری" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button type="submit" variant="secondary">جست‌وجو</Button>
            </div>
          )}
        </Field>
      </form>
      <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={FileText} title="مقاله‌ای با این فیلترها نیست" />}>
        {(d) => (
          <>
            <p className="mb-2 text-sm text-muted-foreground tabular">{fmtNum(d.total)} مقاله</p>
            <Table caption="فهرست مقالات">
              <thead>
                <tr>
                  <Th>مقاله</Th>
                  <Th>نویسنده</Th>
                  <Th>روند</Th>
                  <Th>وضعیت</Th>
                  <Th>داوری دور جاری</Th>
                  <Th>ارسال</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/60">
                    <Td>
                      <Link href={`/t/${slug}/papers/${p.id}`} className="font-medium text-primary hover:underline">{p.title}</Link>
                      <span className="block font-mono text-xs text-muted-foreground" dir="ltr">{p.tracking_code}</span>
                    </Td>
                    <Td>{p.author_name}</Td>
                    <Td>
                      {p.event_title ? `همایش «${p.event_title}»` : p.track_name}
                      <span className="block text-xs text-muted-foreground">{REVIEW_MODE[p.review_mode].label}</span>
                    </Td>
                    <Td><Badge tone={PAPER_STATUS[p.status].tone}>{PAPER_STATUS[p.status].label}</Badge></Td>
                    <Td className="tabular">{p.reviews_total ? `${toFaDigits(String(p.reviews_in))} از ${toFaDigits(String(p.reviews_total))}` : "—"}</Td>
                    <Td className="tabular whitespace-nowrap">{fmtDate(p.submitted_at)}</Td>
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

export default function PapersPage() {
  return (
    <Suspense>
      <PapersInner />
    </Suspense>
  );
}
