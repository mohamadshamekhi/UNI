"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum } from "@uni/shared/format";
import { CASE_STATUS } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { caseRef, CaseStatusBadge } from "@uni/shared/ui/case";
import { Field, Select } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { CaseListItem, RequestType } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

const PAGE = 25;

function CasesInner() {
  const slug = useSlug();
  const router = useRouter();
  const sp = useSearchParams();
  const status = sp.get("status") ?? "open";
  const type = sp.get("type") ?? "";
  const offset = Number(sp.get("offset") ?? 0);
  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("offset" in patch)) next.delete("offset");
    router.replace(`?${next.toString()}`);
  };

  const types = useQuery({ queryKey: ["request-types", slug], queryFn: () => api<RequestType[]>("/v1/cases/request-types", { tenant: slug }) });
  const list = useQuery({
    queryKey: ["cases", slug, status, type, offset],
    queryFn: () =>
      api<{ items: CaseListItem[]; total: number }>("/v1/admin/cases", { tenant: slug, query: { statusCategory: status || undefined, requestType: type || undefined, limit: PAGE, offset } }),
  });

  return (
    <>
      <PageHeader eyebrow="گردش‌کار" title="پرونده‌ها" description="پرونده‌های واحدهایی که به آن‌ها دسترسی دارید." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="وضعیت">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setParam({ status: e.target.value })}>
              <option value="">همه</option>
              {Object.entries(CASE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="نوع درخواست">
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setParam({ type: e.target.value })}>
              <option value="">همه</option>
              {types.data?.map((t) => (
                <option key={t.requestType} value={t.requestType}>{t.nameFa}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={FolderKanban} title="پرونده‌ای با این فیلترها نیست" />}>
        {(d) => (
          <>
            <p className="mb-2 text-sm text-muted-foreground tabular">{fmtNum(d.total)} پرونده</p>
            <Table caption="فهرست پرونده‌ها">
              <thead>
                <tr>
                  <Th>پرونده</Th>
                  <Th>فرایند</Th>
                  <Th>واحد</Th>
                  <Th>وضعیت</Th>
                  <Th>ثبت</Th>
                  <Th>آخرین تغییر</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/60">
                    <Td>
                      <Link href={`/t/${slug}/cases/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.title || `پرونده ${caseRef(c.id)}`}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground" dir="ltr">{caseRef(c.id)}</span>
                    </Td>
                    <Td>{c.workflowName}</Td>
                    <Td>{c.unitNameFa ?? "—"}</Td>
                    <Td><CaseStatusBadge status={c.statusCategory} /></Td>
                    <Td className="tabular whitespace-nowrap">{fmtDate(c.createdAt)}</Td>
                    <Td className="tabular whitespace-nowrap">{fmtDate(c.updatedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <nav aria-label="صفحه‌بندی" className="mt-3 flex items-center justify-between">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setParam({ offset: String(Math.max(0, offset - PAGE)) })}>قبلی</Button>
              <span className="text-xs text-muted-foreground tabular">
                {fmtNum(offset + 1)}–{fmtNum(Math.min(offset + PAGE, d.total))} از {fmtNum(d.total)}
              </span>
              <Button size="sm" variant="secondary" disabled={offset + PAGE >= d.total} onClick={() => setParam({ offset: String(offset + PAGE) })}>بعدی</Button>
            </nav>
          </>
        )}
      </QueryView>
    </>
  );
}

export default function CasesPage() {
  return (
    <Suspense>
      <CasesInner />
    </Suspense>
  );
}
