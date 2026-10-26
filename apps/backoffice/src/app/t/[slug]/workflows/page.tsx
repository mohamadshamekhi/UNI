"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDate, toFaDigits } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog } from "@uni/shared/ui/dialog";
import { Field, Input, Textarea } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useSlug } from "@/lib/hooks";

interface WorkflowRow {
  id: string;
  key: string;
  nameFa: string;
  requestType: string;
  description: string | null;
  createdAt: string;
  publishedVersion: number | null;
  latestVersion: number | null;
}

/** Workflow definitions of the university (WF-02); each request type is driven by one. */
export default function WorkflowsPage() {
  const slug = useSlug();
  const [creating, setCreating] = useState(false);
  const [fromTemplate, setFromTemplate] = useState(false);
  const q = useQuery({ queryKey: ["workflows", slug], queryFn: () => api<WorkflowRow[]>("/v1/admin/workflows", { tenant: slug }) });
  return (
    <>
      <PageHeader
        eyebrow="فرایندها"
        title="گردش‌کارها"
        description="هر نوع درخواست با یک گردش‌کار اجرا می‌شود. تغییرات در نسخه جدید انجام می‌شود و پرونده‌های جاری روی نسخه خودشان می‌مانند."
        actions={
          <>
          <Button variant="secondary" onClick={() => setFromTemplate(true)}>
            <LayoutTemplate aria-hidden className="size-4" />
            از قالب آماده
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            گردش‌کار جدید
          </Button>
          </>
        }
      />
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Workflow} title="هنوز گردش‌کاری تعریف نشده" description="با یک گردش‌کار ساده شروع کنید؛ پیش‌نویس اولیه یک مرحله بررسی دارد." />}>
        {(rows) => (
          <Table caption="فهرست گردش‌کارها">
            <thead>
              <tr>
                <Th>نام</Th>
                <Th>نوع درخواست</Th>
                <Th>نسخه منتشرشده</Th>
                <Th>آخرین نسخه</Th>
                <Th>ایجاد</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="hover:bg-muted/60">
                  <Td>
                    <Link href={`/t/${slug}/workflows/${w.id}`} className="font-medium text-primary hover:underline">{w.nameFa}</Link>
                    {w.description && <span className="block max-w-80 truncate text-xs text-muted-foreground">{w.description}</span>}
                  </Td>
                  <Td><code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">{w.requestType}</code></Td>
                  <Td>{w.publishedVersion ? <Badge tone="success">نسخه {toFaDigits(String(w.publishedVersion))}</Badge> : <Badge>منتشر نشده</Badge>}</Td>
                  <Td className="tabular">{w.latestVersion ? toFaDigits(String(w.latestVersion)) : "—"}</Td>
                  <Td className="tabular whitespace-nowrap">{fmtDate(w.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
      <CreateDialog open={creating} onClose={() => setCreating(false)} />
      <TemplateDialog open={fromTemplate} onClose={() => setFromTemplate(false)} />
    </>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const router = useRouter();
  const [v, setV] = useState({ nameFa: "", key: "", requestType: "", description: "" });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="گردش‌کار جدید"
      submitLabel="ایجاد"
      onSubmit={async () => {
        const w = await api<{ id: string }>("/v1/admin/workflows", {
          method: "POST",
          tenant: slug,
          body: { nameFa: v.nameFa.trim(), key: v.key.trim(), requestType: v.requestType.trim(), description: v.description.trim() || undefined },
        });
        qc.invalidateQueries({ queryKey: ["workflows", slug] });
        router.push(`/t/${slug}/workflows/${w.id}`);
      }}
    >
      <Field label="نام" required>
        {(p) => <Input {...p} value={v.nameFa} maxLength={120} onChange={(e) => setV({ ...v, nameFa: e.target.value })} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="شناسه" required hint="حروف کوچک انگلیسی و خط تیره، مثل thesis-msc">
          {(p) => <Input {...p} dir="ltr" value={v.key} pattern="[a-z][a-z0-9_-]{1,60}" onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase() })} />}
        </Field>
        <Field label="نوع درخواست" required hint="مثل thesis_proposal؛ پرونده‌ها با این نوع ثبت می‌شوند.">
          {(p) => <Input {...p} dir="ltr" value={v.requestType} onChange={(e) => setV({ ...v, requestType: e.target.value.toLowerCase() })} />}
        </Field>
      </div>
      <Field label="توضیح" hint="به متقاضی هنگام انتخاب نوع درخواست نمایش داده می‌شود.">
        {(p) => <Textarea {...p} value={v.description} maxLength={1000} onChange={(e) => setV({ ...v, description: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}

interface Template {
  key: string;
  nameFa: string;
  description: string;
  requestType: string;
  steps: number;
}

/** WF-11: start from a built-in template; it becomes an ordinary draft to adapt and publish. */
function TemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const router = useRouter();
  const templates = useQuery({ queryKey: ["workflow-templates", slug], enabled: open, queryFn: () => api<Template[]>("/v1/admin/workflow-templates", { tenant: slug }) });
  const [picked, setPicked] = useState<Template | null>(null);
  const [v, setV] = useState({ nameFa: "", key: "", requestType: "" });
  const pick = (t: Template) => {
    setPicked(t);
    setV({ nameFa: t.nameFa, key: t.key, requestType: t.requestType });
  };
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      wide
      title="ساخت از قالب آماده"
      submitLabel="ساخت پیش‌نویس"
      onSubmit={async () => {
        if (!picked) throw new Error("یک قالب انتخاب کنید.");
        const w = await api<{ id: string }>(`/v1/admin/workflow-templates/${picked.key}/instantiate`, {
          method: "POST",
          tenant: slug,
          body: { nameFa: v.nameFa.trim(), key: v.key.trim(), requestType: v.requestType.trim(), description: picked.description },
        });
        qc.invalidateQueries({ queryKey: ["workflows", slug] });
        router.push(`/t/${slug}/workflows/${w.id}`);
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">قالب</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {templates.data?.map((t) => (
            <label key={t.key} className="flex cursor-pointer flex-col gap-1.5 rounded-2xl border border-border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-info-bg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary">
              <input type="radio" name="template" className="sr-only" checked={picked?.key === t.key} onChange={() => pick(t)} />
              <span className="font-semibold">{t.nameFa}</span>
              <span className="text-xs leading-5 text-muted-foreground">{t.description}</span>
              <span className="mt-auto text-xs text-gold">{toFaDigits(String(t.steps))} مرحله</span>
            </label>
          ))}
        </div>
      </fieldset>
      {picked && (
        <>
          <Field label="نام" required>
            {(p) => <Input {...p} value={v.nameFa} maxLength={120} onChange={(e) => setV({ ...v, nameFa: e.target.value })} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="شناسه" required>
              {(p) => <Input {...p} dir="ltr" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase() })} />}
            </Field>
            <Field label="نوع درخواست" required>
              {(p) => <Input {...p} dir="ltr" value={v.requestType} onChange={(e) => setV({ ...v, requestType: e.target.value.toLowerCase() })} />}
            </Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}
