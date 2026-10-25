"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ImportDialog } from "@/components/membership/import-dialog";
import { InviteDialog } from "@/components/membership/invite-dialog";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum, toFaDigits } from "@uni/shared/format";
import { useCan, useSlug, useUnits } from "@/lib/hooks";
import { MEMBERSHIP_KIND, MEMBERSHIP_STATUS } from "@uni/shared/labels";
import type { MembershipRow } from "@uni/shared/types";

const PAGE = 25;

function MembershipsInner() {
  const slug = useSlug();
  const can = useCan(slug);
  const router = useRouter();
  const sp = useSearchParams();
  const { flat } = useUnits(slug);
  const status = sp.get("status") ?? "pending_review";
  const unitId = sp.get("unitId") ?? "";
  const kind = sp.get("kind") ?? "";
  const offset = Number(sp.get("offset") ?? 0);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);

  // filters live in the URL so views are shareable and survive back/forward
  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("offset" in patch)) next.delete("offset");
    router.replace(`?${next.toString()}`);
  };

  const list = useQuery({
    queryKey: ["memberships", slug, status, unitId, kind, sp.get("q"), offset],
    queryFn: () =>
      api<{ items: MembershipRow[]; total: number }>("/v1/admin/memberships", {
        tenant: slug,
        query: { status, unitId, kind, q: sp.get("q"), limit: PAGE, offset },
      }),
  });

  return (
    <>
      <PageHeader
        title="عضویت‌ها"
        description="درخواست‌های عضویت در واحدهایی که به آن‌ها دسترسی دارید"
        actions={
          can("membership.manage") && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <FileSpreadsheet aria-hidden className="size-4" />
                ورود گروهی
              </Button>
              <Button onClick={() => setInviting(true)}>
                <UserPlus aria-hidden className="size-4" />
                دعوت عضو
              </Button>
            </>
          )
        }
      />
      <form
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ q });
        }}
      >
        <Field label="وضعیت">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setParam({ status: e.target.value })}>
              {Object.entries(MEMBERSHIP_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="نوع">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setParam({ kind: e.target.value })}>
              <option value="">همه</option>
              {Object.entries(MEMBERSHIP_KIND).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="واحد">
          {(p) => (
            <Select {...p} value={unitId} onChange={(e) => setParam({ unitId: e.target.value })}>
              <option value="">همه واحدهای مجاز</option>
              {flat.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="جست‌وجو" className="lg:col-span-2">
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} placeholder="نام یا شماره دانشجویی" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button type="submit" variant="secondary">جست‌وجو</Button>
            </div>
          )}
        </Field>
      </form>

      <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="درخواستی با این فیلترها نیست" />}>
        {(d) => (
          <>
            <p className="mb-2 text-sm text-muted-foreground tabular">{fmtNum(d.total)} مورد</p>
            <Table caption="فهرست عضویت‌ها">
              <thead>
                <tr>
                  <Th>نام</Th>
                  <Th>نوع</Th>
                  <Th>شماره</Th>
                  <Th>واحد</Th>
                  <Th>وضعیت</Th>
                  <Th>ثبت</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/60">
                    <Td>
                      <Link href={`/t/${slug}/memberships/${m.id}`} className="font-medium text-primary hover:underline">
                        {m.fullName}
                      </Link>
                    </Td>
                    <Td>{MEMBERSHIP_KIND[m.kind]}</Td>
                    <Td className="tabular">{m.memberNo ? toFaDigits(m.memberNo) : "—"}</Td>
                    <Td>{m.unitNameFa ?? "—"}</Td>
                    <Td>
                      <Badge tone={MEMBERSHIP_STATUS[m.status].tone}>{MEMBERSHIP_STATUS[m.status].label}</Badge>
                    </Td>
                    <Td className="tabular whitespace-nowrap">{fmtDate(m.submittedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <nav aria-label="صفحه‌بندی" className="mt-3 flex items-center justify-between">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setParam({ offset: String(Math.max(0, offset - PAGE)) })}>
                قبلی
              </Button>
              <span className="text-xs text-muted-foreground tabular">
                {fmtNum(offset + 1)}–{fmtNum(Math.min(offset + PAGE, d.total))} از {fmtNum(d.total)}
              </span>
              <Button size="sm" variant="secondary" disabled={offset + PAGE >= d.total} onClick={() => setParam({ offset: String(offset + PAGE) })}>
                بعدی
              </Button>
            </nav>
          </>
        )}
      </QueryView>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

export default function MembershipsPage() {
  return (
    <Suspense>
      <MembershipsInner />
    </Suspense>
  );
}
