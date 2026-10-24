"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/layout";
import { EmptyState, QueryView } from "@/components/ui/states";
import { api } from "@/lib/api";
import { fmtDateTime, shortId } from "@/lib/format";
import { AUDIT_RESULT } from "@/lib/labels";
import type { AuditRow } from "@/lib/types";

const PAGE = 50;

/** Audit search (AUD-06) shared by the tenant and platform panels. */
export function AuditLog({ basePath, tenant, extraQuery }: { basePath: string; tenant?: string; extraQuery?: Record<string, string> }) {
  const [filters, setFilters] = useState({ action: "", targetId: "" });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const rows = useQuery({
    queryKey: ["audit", basePath, tenant, applied, offset, extraQuery],
    queryFn: () => api<AuditRow[]>(basePath, { tenant, query: { ...applied, ...extraQuery, limit: PAGE, offset } }),
  });
  const verify = useQuery({
    queryKey: ["audit-verify", basePath, tenant, extraQuery],
    queryFn: () => api<{ intact: boolean; broken: { id: string; seq: number } | null }>(`${basePath}/verify`, { tenant, query: extraQuery }),
    enabled: false,
  });

  return (
    <>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setApplied(filters);
        }}
      >
        <Field label="عمل" className="w-56">
          {(p) => <Input {...p} dir="ltr" placeholder="membership.approved" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />}
        </Field>
        <Field label="شناسه هدف" className="w-72">
          {(p) => <Input {...p} dir="ltr" value={filters.targetId} onChange={(e) => setFilters({ ...filters, targetId: e.target.value })} />}
        </Field>
        <Button type="submit" variant="secondary">اعمال فیلتر</Button>
        <Button variant="ghost" onClick={() => verify.refetch()} loading={verify.isFetching}>
          بررسی سلامت زنجیره
        </Button>
        {verify.data && (
          <span role="status" className={`inline-flex items-center gap-1.5 text-sm ${verify.data.intact ? "text-success" : "text-danger"}`}>
            {verify.data.intact ? <ShieldCheck aria-hidden className="size-4" /> : <ShieldAlert aria-hidden className="size-4" />}
            {verify.data.intact ? "زنجیره ممیزی سالم است." : `دستکاری در رکورد ${verify.data.broken?.seq} تشخیص داده شد.`}
          </span>
        )}
      </form>

      <QueryView query={rows} isEmpty={(d) => d.length === 0 && offset === 0} empty={<EmptyState title="رکوردی پیدا نشد" />}>
        {(data) => (
          <>
            <Table caption="رکوردهای ممیزی">
              <thead>
                <tr>
                  <Th>زمان</Th>
                  <Th>عمل</Th>
                  <Th>عامل</Th>
                  <Th>هدف</Th>
                  <Th>نتیجه</Th>
                  <Th>
                    <span className="sr-only">جزئیات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/60">
                    <Td className="tabular whitespace-nowrap">{fmtDateTime(r.occurredAt)}</Td>
                    <Td>
                      <code dir="ltr" className="text-xs">{r.action}</code>
                    </Td>
                    <Td className="text-xs">{r.actorType === "system" ? "سیستم" : <code dir="ltr">{shortId(r.actorUserId)}</code>}</Td>
                    <Td className="text-xs">
                      {r.targetType ? (
                        <span dir="ltr">
                          {r.targetType}:{shortId(r.targetId)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <Badge tone={AUDIT_RESULT[r.result]?.tone}>{AUDIT_RESULT[r.result]?.label ?? r.result}</Badge>
                    </Td>
                    <Td>
                      <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                        جزئیات
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-3 flex items-center justify-between">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                قبلی
              </Button>
              <Button size="sm" variant="secondary" disabled={data.length < PAGE} onClick={() => setOffset(offset + PAGE)}>
                بعدی
              </Button>
            </div>
          </>
        )}
      </QueryView>

      <Dialog open={!!detail} onClose={() => setDetail(null)} title="جزئیات رکورد ممیزی" wide>
        {detail && (
          <pre dir="ltr" className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
            {JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </Dialog>
    </>
  );
}
