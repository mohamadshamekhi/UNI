"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Workflow } from "lucide-react";
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
  const q = useQuery({ queryKey: ["workflows", slug], queryFn: () => api<WorkflowRow[]>("/v1/admin/workflows", { tenant: slug }) });
  return (
    <>
      <PageHeader
        eyebrow="فرایندها"
        title="گردش‌کارها"
        description="هر نوع درخواست با یک گردش‌کار اجرا می‌شود. تغییرات در نسخه جدید انجام می‌شود و پرونده‌های جاری روی نسخه خودشان می‌مانند."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            گردش‌کار جدید
          </Button>
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
