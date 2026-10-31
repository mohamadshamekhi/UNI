"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input } from "@uni/shared/ui/field";
import { Card, Dl, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { api, errorMessage } from "@uni/shared/api";
import { fmtBytes, fmtDateTime } from "@uni/shared/format";
import { MODULES, TENANT_STATUS } from "@uni/shared/labels";
import type { Tenant, TenantStatus } from "@uni/shared/types";
import { TenantOverview } from "@/components/platform/tenant-overview";

const NEXT_STATUS: Record<TenantStatus, { to: TenantStatus; label: string; danger: boolean }[]> = {
  draft: [
    { to: "active", label: "فعال‌سازی", danger: false },
    { to: "archived", label: "بایگانی", danger: true },
  ],
  active: [
    { to: "suspended", label: "تعلیق", danger: true },
    { to: "archived", label: "بایگانی", danger: true },
  ],
  suspended: [
    { to: "active", label: "رفع تعلیق", danger: false },
    { to: "archived", label: "بایگانی", danger: true },
  ],
  archived: [],
};

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenant = useQuery({ queryKey: ["platform-tenant", id], queryFn: () => api<Tenant>(`/v1/platform/tenants/${id}`) });
  return (
    <>
      <Link href="/platform/tenants" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        سازمان‌ها
      </Link>
      <QueryView query={tenant}>{(t) => <TenantDetail tenant={t} />}</QueryView>
    </>
  );
}

function TenantDetail({ tenant: t }: { tenant: Tenant }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [statusTo, setStatusTo] = useState<{ to: TenantStatus; label: string } | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["platform-tenant", t.id] });
    qc.invalidateQueries({ queryKey: ["platform-tenants"] });
  };
  const st = TENANT_STATUS[t.status];

  return (
    <>
      <PageHeader
        title={t.nameFa}
        description={t.nameEn ?? undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAddingAdmin(true)} disabled={t.status === "archived"}>
              <UserPlus aria-hidden className="size-4" />
              معرفی مدیر دانشگاه
            </Button>
            {NEXT_STATUS[t.status].map((s) => (
              <Button key={s.to} variant={s.danger ? "danger" : "primary"} onClick={() => setStatusTo(s)}>
                {s.label}
              </Button>
            ))}
          </>
        }
      />
      <TenantOverview tenantId={t.id} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="مشخصات">
          <Dl
            items={[
              ["وضعیت", <Badge key="s" tone={st.tone}>{st.label}</Badge>],
              ["شناسه", <code key="slug" dir="ltr">{t.slug}</code>],
              ["دامنه اختصاصی", t.domain ? <span dir="ltr">{t.domain}</span> : "—"],
              ["تقویم", t.settings.calendar === "gregorian" ? "میلادی" : "شمسی"],
              ["سهمیه فضا", t.settings.storageQuotaBytes ? fmtBytes(t.settings.storageQuotaBytes) : "—"],
              ["ایجاد", <span key="c" className="tabular">{fmtDateTime(t.createdAt)}</span>],
            ]}
          />
        </Card>
        <ModulesCard tenant={t} onSaved={refresh} />
        <EditCard tenant={t} onSaved={refresh} />
      </div>

      <ReasonDialog
        open={!!statusTo}
        onClose={() => setStatusTo(null)}
        title={`${statusTo?.label ?? ""} «${t.nameFa}»`}
        description={statusTo?.to === "suspended" ? "ورود همه کاربران این سازمان تا رفع تعلیق مسدود می‌شود؛ داده‌ها حفظ می‌شوند." : statusTo?.to === "archived" ? "سازمان فقط‌خواندنی می‌شود و این اقدام برگشت‌پذیر نیست." : undefined}
        submitLabel={statusTo?.label ?? ""}
        danger={statusTo?.to !== "active"}
        onConfirm={async (reason) => {
          await api(`/v1/platform/tenants/${t.id}/status`, { method: "POST", body: { status: statusTo!.to, reason } });
          refresh();
          toast("وضعیت سازمان تغییر کرد.");
        }}
      />
      <AddAdminDialog open={addingAdmin} onClose={() => setAddingAdmin(false)} tenantId={t.id} />
    </>
  );
}

function ModulesCard({ tenant: t, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>(t.enabledModules);
  const savedKey = t.enabledModules.join();
  const [lastSaved, setLastSaved] = useState(savedKey);
  if (savedKey !== lastSaved) {
    setLastSaved(savedKey);
    setSelected(t.enabledModules);
  }
  const save = useMutation({
    mutationFn: () => api(`/v1/platform/tenants/${t.id}/modules`, { method: "PUT", body: { modules: selected } }),
    onSuccess: () => {
      onSaved();
      toast("ماژول‌ها ذخیره شد.");
    },
  });
  const dirty = [...selected].sort().join() !== [...t.enabledModules].sort().join();
  return (
    <Card title="ماژول‌های فعال" actions={<Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button>}>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="sr-only">ماژول‌ها</legend>
        {Object.entries(MODULES).map(([key, label]) => (
          <Checkbox key={key} label={label} checked={selected.includes(key)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, key] : s.filter((x) => x !== key)))} />
        ))}
      </fieldset>
      {save.error && <p role="alert" className="mt-3 text-sm text-danger">{errorMessage(save.error)}</p>}
    </Card>
  );
}

function EditCard({ tenant: t, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ nameFa: t.nameFa, nameEn: t.nameEn ?? "", domain: t.domain ?? "", quotaGb: String(Math.round((t.settings.storageQuotaBytes ?? 0) / 1024 ** 3)) });
  const save = useMutation({
    mutationFn: () =>
      api(`/v1/platform/tenants/${t.id}`, {
        method: "PATCH",
        body: {
          nameFa: form.nameFa.trim(),
          nameEn: form.nameEn.trim() || undefined,
          domain: form.domain.trim() || undefined,
          settings: { storageQuotaBytes: Number(form.quotaGb) * 1024 ** 3 },
        },
      }),
    onSuccess: () => {
      onSaved();
      toast("تغییرات ذخیره شد.");
    },
  });
  return (
    <Card title="ویرایش" className="lg:col-span-2">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="نام فارسی" required>{(p) => <Input {...p} value={form.nameFa} onChange={(e) => setForm({ ...form, nameFa: e.target.value })} />}</Field>
        <Field label="نام انگلیسی">{(p) => <Input {...p} dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />}</Field>
        <Field label="دامنه اختصاصی">{(p) => <Input {...p} dir="ltr" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />}</Field>
        <Field label="سهمیه فضای ذخیره (گیگابایت)">{(p) => <Input {...p} type="number" min={0} dir="ltr" value={form.quotaGb} onChange={(e) => setForm({ ...form, quotaGb: e.target.value })} />}</Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={save.isPending}>ذخیره</Button>
          {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
        </div>
      </form>
    </Card>
  );
}

function AddAdminDialog({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId: string }) {
  const toast = useToast();
  const [mobile, setMobile] = useState("");
  const [fullName, setFullName] = useState("");
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="معرفی مدیر دانشگاه"
      submitLabel="معرفی"
      onSubmit={async () => {
        await api(`/v1/platform/tenants/${tenantId}/admins`, { method: "POST", body: { mobile, fullName } });
        toast("مدیر دانشگاه معرفی شد؛ رمز خود را از «فراموشی رمز» تعیین می‌کند.");
        setMobile("");
        setFullName("");
      }}
    >
      <p className="text-sm text-muted-foreground">نقش «مدیر دانشگاه» در کل سازمان به این فرد داده می‌شود. اگر حساب داشته باشد، همان حساب استفاده می‌شود.</p>
      <Field label="نام و نام خانوادگی" required>{(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />}</Field>
      <Field label="شماره موبایل" required hint="مثلاً ۰۹۱۲۱۲۳۴۵۶۷">{(p) => <Input {...p} dir="ltr" inputMode="tel" autoComplete="off" value={mobile} onChange={(e) => setMobile(e.target.value)} />}</Field>
    </FormDialog>
  );
}
