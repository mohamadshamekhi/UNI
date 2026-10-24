"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, Table, Td, Th } from "@/components/ui/layout";
import { EmptyState, QueryView } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { MODULES, TENANT_STATUS } from "@/lib/labels";
import type { Tenant } from "@/lib/types";

export default function TenantsPage() {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const tenants = useQuery({ queryKey: ["platform-tenants", q], queryFn: () => api<Tenant[]>("/v1/platform/tenants", { query: { q } }) });

  return (
    <>
      <PageHeader
        title="سازمان‌ها"
        description="دانشگاه‌ها و مؤسسات تعریف‌شده در سامانه"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            سازمان جدید
          </Button>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="جست‌وجوی سازمان" placeholder="جست‌وجو با نام یا شناسه" value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" />
      </div>
      <QueryView
        query={tenants}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="سازمانی پیدا نشد" description="اولین دانشگاه را با «سازمان جدید» اضافه کنید." />}
      >
        {(rows) => (
          <Table caption="فهرست سازمان‌ها">
            <thead>
              <tr>
                <Th>نام</Th>
                <Th>شناسه</Th>
                <Th>وضعیت</Th>
                <Th>ماژول‌ها</Th>
                <Th>تاریخ ایجاد</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-muted/60">
                  <Td>
                    <Link href={`/platform/tenants/${t.id}`} className="font-medium text-primary hover:underline">
                      {t.nameFa}
                    </Link>
                    {t.nameEn && <span className="block text-xs text-muted-foreground">{t.nameEn}</span>}
                  </Td>
                  <Td>
                    <code dir="ltr" className="text-xs">
                      {t.slug}
                    </code>
                  </Td>
                  <Td>
                    <Badge tone={TENANT_STATUS[t.status].tone}>{TENANT_STATUS[t.status].label}</Badge>
                  </Td>
                  <Td className="text-xs text-muted-foreground">{t.enabledModules.length ? t.enabledModules.map((m) => MODULES[m] ?? m).join("، ") : "—"}</Td>
                  <Td className="tabular">{fmtDate(t.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
      <CreateTenantDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ slug: "", nameFa: "", nameEn: "", domain: "" });
  const create = useMutation({
    mutationFn: () =>
      api<Tenant>("/v1/platform/tenants", {
        method: "POST",
        body: { slug: form.slug.trim(), nameFa: form.nameFa.trim(), nameEn: form.nameEn.trim() || undefined, domain: form.domain.trim() || undefined },
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      toast(`سازمان «${t.nameFa}» در وضعیت پیش‌نویس ساخته شد.`);
      setForm({ slug: "", nameFa: "", nameEn: "", domain: "" });
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <FormDialog open={open} onClose={onClose} title="سازمان جدید" submitLabel="ایجاد" onSubmit={() => create.mutateAsync()}>
      <Field label="نام فارسی" required>
        {(p) => <Input {...p} value={form.nameFa} onChange={set("nameFa")} />}
      </Field>
      <Field label="نام انگلیسی">{(p) => <Input {...p} dir="ltr" value={form.nameEn} onChange={set("nameEn")} />}</Field>
      <Field label="شناسه (زیردامنه)" required hint="حروف کوچک انگلیسی، عدد و خط تیره؛ مثلاً ut">
        {(p) => <Input {...p} dir="ltr" pattern="[a-z0-9-]+" value={form.slug} onChange={set("slug")} />}
      </Field>
      <Field label="دامنه اختصاصی" hint="اختیاری؛ مثلاً portal.ut.ac.ir">
        {(p) => <Input {...p} dir="ltr" value={form.domain} onChange={set("domain")} />}
      </Field>
    </FormDialog>
  );
}
