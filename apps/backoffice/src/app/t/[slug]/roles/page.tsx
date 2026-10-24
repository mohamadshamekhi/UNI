"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog, ReasonDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Card, PageHeader } from "@/components/ui/layout";
import { QueryView } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useSlug } from "@/lib/hooks";
import { PERMISSION_MODULES } from "@/lib/labels";
import type { PermissionDef, Role } from "@/lib/types";

type Dlg = { kind: "create" } | { kind: "edit"; role: Role } | { kind: "copy"; role: Role } | { kind: "archive"; role: Role } | null;

export default function RolesPage() {
  const slug = useSlug();
  const roles = useQuery({ queryKey: ["roles", slug], queryFn: () => api<Role[]>("/v1/admin/roles", { tenant: slug }) });
  const catalog = useQuery({ queryKey: ["permission-catalog", slug], queryFn: () => api<PermissionDef[]>("/v1/admin/permissions", { tenant: slug }) });
  const [dlg, setDlg] = useState<Dlg>(null);
  const desc = useMemo(() => new Map((catalog.data ?? []).map((p) => [p.code, p.description])), [catalog.data]);

  return (
    <>
      <PageHeader
        title="نقش‌ها و دسترسی"
        description="هر نقش مجموعه‌ای از مجوزهای پایه است؛ دامنه (کل سازمان یا یک واحد) هنگام انتساب به فرد تعیین می‌شود."
        actions={
          <Button onClick={() => setDlg({ kind: "create" })}>
            <Plus aria-hidden className="size-4" />
            نقش جدید
          </Button>
        }
      />
      <QueryView query={roles}>
        {(rows) => (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((r) => (
              <Card
                key={r.id}
                title={r.nameFa}
                actions={
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "edit", role: r })}>ویرایش</Button>
                    <Button size="sm" variant="ghost" aria-label={`کپی ${r.nameFa}`} onClick={() => setDlg({ kind: "copy", role: r })}>
                      <Copy aria-hidden className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDlg({ kind: "archive", role: r })}>بایگانی</Button>
                  </div>
                }
              >
                <div className="mb-2 flex items-center gap-2">
                  {r.templateKey && <Badge tone="info">از قالب سیستمی</Badge>}
                  <code dir="ltr" className="text-xs text-muted-foreground">{r.key}</code>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {r.permissions.map((p) => (
                    <li key={p} className="rounded bg-muted px-2 py-0.5 text-xs" title={p}>
                      {desc.get(p) ?? p}
                    </li>
                  ))}
                  {r.permissions.length === 0 && <li className="text-xs text-muted-foreground">بدون مجوز</li>}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      <RoleEditor dlg={dlg} close={() => setDlg(null)} catalog={catalog.data ?? []} />
    </>
  );
}

function RoleEditor({ dlg, close, catalog }: { dlg: Dlg; close: () => void; catalog: PermissionDef[] }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ key: "", nameFa: "", permissions: [] as string[] });
  const [lastDlg, setLastDlg] = useState<Dlg>(null);
  if (dlg !== lastDlg) {
    setLastDlg(dlg);
    if (dlg?.kind === "edit") setForm({ key: dlg.role.key, nameFa: dlg.role.nameFa, permissions: dlg.role.permissions });
    else if (dlg?.kind === "copy") setForm({ key: `${dlg.role.key}_copy`, nameFa: `${dlg.role.nameFa} (کپی)`, permissions: dlg.role.permissions });
    else setForm({ key: "", nameFa: "", permissions: [] });
  }
  const editingId = dlg?.kind === "edit" ? dlg.role.id : undefined;
  // ACL-12: who is affected before the change is saved
  const impact = useQuery({
    queryKey: ["role-impact", slug, editingId],
    queryFn: () => api<{ activeAssignments: number; affectedMembers: number }>(`/v1/admin/roles/${editingId}/impact`, { tenant: slug }),
    enabled: !!editingId,
  });
  const archiveId = dlg?.kind === "archive" ? dlg.role.id : undefined;
  const archiveImpact = useQuery({
    queryKey: ["role-impact", slug, archiveId],
    queryFn: () => api<{ activeAssignments: number; affectedMembers: number }>(`/v1/admin/roles/${archiveId}/impact`, { tenant: slug }),
    enabled: !!archiveId,
  });
  const grouped = useMemo(() => {
    const m = new Map<string, PermissionDef[]>();
    for (const p of catalog) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalog]);
  const refresh = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["roles", slug] });
    qc.invalidateQueries({ queryKey: ["perms", slug] });
    toast(msg);
  };
  const toggle = (code: string, on: boolean) => setForm((f) => ({ ...f, permissions: on ? [...f.permissions, code] : f.permissions.filter((x) => x !== code) }));

  const open = dlg?.kind === "create" || dlg?.kind === "edit" || dlg?.kind === "copy";
  return (
    <>
      <FormDialog
        wide
        open={open}
        onClose={close}
        title={dlg?.kind === "edit" ? `ویرایش «${dlg.role.nameFa}»` : dlg?.kind === "copy" ? "کپی نقش" : "نقش جدید"}
        submitLabel="ذخیره"
        onSubmit={async () => {
          if (dlg?.kind === "edit") {
            await api(`/v1/admin/roles/${dlg.role.id}`, { method: "PATCH", tenant: slug, body: { nameFa: form.nameFa, permissions: form.permissions } });
          } else {
            await api("/v1/admin/roles", { method: "POST", tenant: slug, body: { key: form.key, nameFa: form.nameFa, permissions: form.permissions } });
          }
          refresh("نقش ذخیره شد.");
        }}
      >
        {dlg?.kind === "edit" && impact.data && (
          <p role="status" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            این تغییر روی {fmtNum(impact.data.affectedMembers)} نفر ({fmtNum(impact.data.activeAssignments)} انتساب فعال) اثر می‌گذارد.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام نقش" required>{(p) => <Input {...p} value={form.nameFa} onChange={(e) => setForm({ ...form, nameFa: e.target.value })} />}</Field>
          <Field label="کلید" required hint="حروف کوچک انگلیسی و _">
            {(p) => <Input {...p} dir="ltr" disabled={dlg?.kind === "edit"} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />}
          </Field>
        </div>
        {grouped.map(([module, perms]) => (
          <fieldset key={module} className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{PERMISSION_MODULES[module] ?? module}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {perms.map((p) => (
                <Checkbox key={p.code} label={p.description} description={p.code} checked={form.permissions.includes(p.code)} onChange={(e) => toggle(p.code, e.target.checked)} />
              ))}
            </div>
          </fieldset>
        ))}
      </FormDialog>
      <ReasonDialog
        open={dlg?.kind === "archive"}
        onClose={close}
        title={dlg?.kind === "archive" ? `بایگانی «${dlg.role.nameFa}»` : ""}
        description={archiveImpact.data ? `${fmtNum(archiveImpact.data.affectedMembers)} نفر این نقش را دارند و مجوزهای آن را از دست می‌دهند.` : undefined}
        submitLabel="بایگانی"
        onConfirm={async (reason) => {
          if (dlg?.kind !== "archive") return;
          await api(`/v1/admin/roles/${dlg.role.id}/archive`, { method: "POST", tenant: slug, body: { reason } });
          refresh("نقش بایگانی شد.");
        }}
      />
    </>
  );
}
