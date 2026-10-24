"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, FolderTree, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select } from "@uni/shared/ui/field";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { api } from "@uni/shared/api";
import { useSlug, useUnits } from "@/lib/hooks";
import type { UnitNode, UnitType } from "@uni/shared/types";

type Dlg = { kind: "create"; parent: UnitNode | null } | { kind: "edit" | "move" | "archive"; unit: UnitNode } | { kind: "type" } | null;

export default function UnitsPage() {
  const slug = useSlug();
  const { tree, types } = useUnits(slug);
  const [dlg, setDlg] = useState<Dlg>(null);
  const typeName = (id: string) => types.data?.find((t) => t.id === id)?.nameFa ?? "";

  return (
    <>
      <PageHeader
        title="ساختار سازمانی"
        description="درخت واحدها؛ سطح اول باید از نوع «دانشکده» (یا معادل آن) باشد."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDlg({ kind: "type" })}>نوع واحد جدید</Button>
            <Button onClick={() => setDlg({ kind: "create", parent: null })}>
              <Plus aria-hidden className="size-4" />
              دانشکده جدید
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QueryView query={tree} isEmpty={(d) => d.length === 0} empty={<EmptyState title="هنوز واحدی تعریف نشده" description="با «دانشکده جدید» شروع کنید." />}>
            {(nodes) => (
              <ul role="tree" aria-label="درخت واحدها" className="rounded-lg border border-border bg-card p-2">
                {nodes.map((n) => (
                  <TreeItem key={n.id} node={n} typeName={typeName} onAction={setDlg} />
                ))}
              </ul>
            )}
          </QueryView>
        </div>
        <Card title="انواع واحد">
          <ul className="flex flex-col gap-2 text-sm">
            {types.data?.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span>{t.nameFa}</span>
                {t.isFacultyLevel && <Badge tone="info">سطح دانشکده</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <UnitDialogs dlg={dlg} close={() => setDlg(null)} types={types.data ?? []} />
    </>
  );
}

function TreeItem({ node, typeName, onAction }: { node: UnitNode; typeName: (id: string) => string; onAction: (d: Dlg) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={false}>
      <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-muted">
        <button
          type="button"
          aria-label={expanded ? "بستن" : "باز کردن"}
          onClick={() => setExpanded((v) => !v)}
          className={`cursor-pointer rounded p-1 ${hasChildren ? "" : "invisible"}`}
        >
          {expanded ? <ChevronDown aria-hidden className="size-4" /> : <ChevronLeft aria-hidden className="size-4" />}
        </button>
        <FolderTree aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{node.nameFa}</span>
        <span className="text-xs text-muted-foreground">{typeName(node.typeId)}</span>
        {node.code && <code className="text-xs text-muted-foreground" dir="ltr">{node.code}</code>}
        <span className="ms-auto flex gap-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button size="sm" variant="ghost" onClick={() => onAction({ kind: "create", parent: node })}>زیرواحد</Button>
          <Button size="sm" variant="ghost" onClick={() => onAction({ kind: "edit", unit: node })}>ویرایش</Button>
          <Button size="sm" variant="ghost" onClick={() => onAction({ kind: "move", unit: node })}>جابه‌جایی</Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onAction({ kind: "archive", unit: node })}>بایگانی</Button>
        </span>
      </div>
      {hasChildren && expanded && (
        <ul role="group" className="ms-5 border-s border-border ps-2">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} typeName={typeName} onAction={onAction} />
          ))}
        </ul>
      )}
    </li>
  );
}

function UnitDialogs({ dlg, close, types }: { dlg: Dlg; close: () => void; types: UnitType[] }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { flat } = useUnits(slug);
  const [form, setForm] = useState({ nameFa: "", nameEn: "", code: "", typeId: "", parentId: "", key: "", isFacultyLevel: false });
  const refresh = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["units", slug] });
    qc.invalidateQueries({ queryKey: ["unit-types", slug] });
    toast(msg);
  };
  const reset = (patch: Partial<typeof form> = {}) => setForm({ nameFa: "", nameEn: "", code: "", typeId: "", parentId: "", key: "", isFacultyLevel: false, ...patch });
  const [lastDlg, setLastDlg] = useState<Dlg>(null);
  if (dlg !== lastDlg) {
    setLastDlg(dlg);
    if (dlg?.kind === "edit") reset({ nameFa: dlg.unit.nameFa, nameEn: dlg.unit.nameEn ?? "", code: dlg.unit.code ?? "" });
    else if (dlg?.kind === "move") reset({ parentId: dlg.unit.parentId ?? "" });
    else if (dlg) reset({ typeId: dlg.kind === "create" && !dlg.parent ? (types.find((t) => t.isFacultyLevel)?.id ?? "") : "" });
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const allowedTypes = dlg?.kind === "create" && !dlg.parent ? types.filter((t) => t.isFacultyLevel) : types;

  return (
    <>
      <FormDialog
        open={dlg?.kind === "create"}
        onClose={close}
        title={dlg?.kind === "create" && dlg.parent ? `زیرواحد «${dlg.parent.nameFa}»` : "دانشکده جدید"}
        submitLabel="ایجاد"
        onSubmit={async () => {
          if (dlg?.kind !== "create") return;
          await api("/v1/admin/units", {
            method: "POST",
            tenant: slug,
            body: { nameFa: form.nameFa, nameEn: form.nameEn || undefined, code: form.code || undefined, typeId: form.typeId, parentId: dlg.parent?.id },
          });
          refresh("واحد ایجاد شد.");
        }}
      >
        <Field label="نوع" required>
          {(p) => (
            <Select {...p} value={form.typeId} onChange={set("typeId")}>
              <option value="" disabled>انتخاب کنید</option>
              {allowedTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.nameFa}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="نام فارسی" required>{(p) => <Input {...p} value={form.nameFa} onChange={set("nameFa")} />}</Field>
        <Field label="نام انگلیسی">{(p) => <Input {...p} dir="ltr" value={form.nameEn} onChange={set("nameEn")} />}</Field>
        <Field label="کد">{(p) => <Input {...p} dir="ltr" value={form.code} onChange={set("code")} />}</Field>
      </FormDialog>

      <FormDialog
        open={dlg?.kind === "edit"}
        onClose={close}
        title="ویرایش واحد"
        submitLabel="ذخیره"
        onSubmit={async () => {
          if (dlg?.kind !== "edit") return;
          await api(`/v1/admin/units/${dlg.unit.id}`, { method: "PATCH", tenant: slug, body: { nameFa: form.nameFa, nameEn: form.nameEn || undefined, code: form.code || undefined } });
          refresh("تغییرات ذخیره شد.");
        }}
      >
        <Field label="نام فارسی" required>{(p) => <Input {...p} value={form.nameFa} onChange={set("nameFa")} />}</Field>
        <Field label="نام انگلیسی">{(p) => <Input {...p} dir="ltr" value={form.nameEn} onChange={set("nameEn")} />}</Field>
        <Field label="کد">{(p) => <Input {...p} dir="ltr" value={form.code} onChange={set("code")} />}</Field>
      </FormDialog>

      <MoveDialog dlg={dlg} close={close} flat={flat} parentId={form.parentId} setParentId={(v) => setForm((f) => ({ ...f, parentId: v }))} onDone={() => refresh("واحد جابه‌جا شد.")} />

      <ReasonDialog
        open={dlg?.kind === "archive"}
        onClose={close}
        title={dlg?.kind === "archive" ? `بایگانی «${dlg.unit.nameFa}»` : ""}
        description="فقط واحدی که زیرواحد یا عضو فعال ندارد بایگانی می‌شود."
        submitLabel="بایگانی"
        onConfirm={async (reason) => {
          if (dlg?.kind !== "archive") return;
          await api(`/v1/admin/units/${dlg.unit.id}/archive`, { method: "POST", tenant: slug, body: { reason } });
          refresh("واحد بایگانی شد.");
        }}
      />

      <FormDialog
        open={dlg?.kind === "type"}
        onClose={close}
        title="نوع واحد جدید"
        submitLabel="ایجاد"
        onSubmit={async () => {
          await api("/v1/admin/unit-types", { method: "POST", tenant: slug, body: { key: form.key, nameFa: form.nameFa, nameEn: form.nameEn || undefined, isFacultyLevel: form.isFacultyLevel } });
          refresh("نوع واحد ایجاد شد.");
        }}
      >
        <Field label="نام فارسی" required hint="مثلاً «پژوهشکده» یا «مدرسه»">{(p) => <Input {...p} value={form.nameFa} onChange={set("nameFa")} />}</Field>
        <Field label="کلید" required hint="حروف کوچک انگلیسی و _">{(p) => <Input {...p} dir="ltr" value={form.key} onChange={set("key")} />}</Field>
        <Checkbox label="هم‌سطح دانشکده" description="می‌تواند در سطح اول درخت قرار بگیرد." checked={form.isFacultyLevel} onChange={(e) => setForm((f) => ({ ...f, isFacultyLevel: e.target.checked }))} />
      </FormDialog>
    </>
  );
}

function MoveDialog({ dlg, close, flat, parentId, setParentId, onDone }: { dlg: Dlg; close: () => void; flat: (UnitNode & { label: string })[]; parentId: string; setParentId: (v: string) => void; onDone: () => void }) {
  const slug = useSlug();
  const [reason, setReason] = useState("");
  if (dlg?.kind !== "move") return <FormDialog open={false} onClose={close} title="" submitLabel="" onSubmit={async () => {}}>{null}</FormDialog>;
  const self = dlg.unit;
  // a unit can't move under itself or its descendants
  const candidates = flat.filter((u) => u.id !== self.id && !u.label.startsWith(`${flat.find((x) => x.id === self.id)?.label} ›`));
  return (
    <FormDialog
      open
      onClose={close}
      title={`جابه‌جایی «${self.nameFa}»`}
      submitLabel="جابه‌جایی"
      onSubmit={async () => {
        await api(`/v1/admin/units/${self.id}/move`, { method: "POST", tenant: slug, body: { parentId: parentId || undefined, reason: reason.trim() } });
        onDone();
        setReason("");
      }}
    >
      <Field label="والد جدید">
        {(p) => (
          <Select {...p} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">سطح اول (بدون والد)</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="دلیل" required>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </FormDialog>
  );
}
