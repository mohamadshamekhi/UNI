"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, PageHeader } from "@/components/ui/layout";
import { QueryView } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useSlug } from "@/lib/hooks";
import type { Tenant, TenantSettings } from "@/lib/types";

export default function SettingsPage() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["tenant-admin", slug], queryFn: () => api<Tenant>("/v1/admin/tenant", { tenant: slug }) });
  return (
    <>
      <PageHeader title="تنظیمات سازمان" description="هویت بصری، تقویم و سیاست‌های عضویت" />
      <QueryView query={q}>{(t) => <SettingsForm settings={t.settings} />}</QueryView>
    </>
  );
}

function SettingsForm({ settings }: { settings: TenantSettings }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    displayName: settings.branding?.displayName ?? "",
    primaryColor: settings.branding?.primaryColor ?? "#1e40af",
    calendar: settings.calendar ?? "jalali",
    minLength: String(settings.passwordPolicy?.minLength ?? 8),
    revisionDeadlineDays: String(settings.membership?.revisionDeadlineDays ?? 7),
    reapplyAfterDays: String(settings.membership?.reapplyAfterDays ?? 0),
  });
  const save = useMutation({
    mutationFn: () =>
      api("/v1/admin/tenant/settings", {
        method: "PATCH",
        tenant: slug,
        body: {
          calendar: f.calendar,
          branding: { ...settings.branding, displayName: f.displayName || undefined, primaryColor: f.primaryColor },
          passwordPolicy: { minLength: Number(f.minLength) },
          membership: { revisionDeadlineDays: Number(f.revisionDeadlineDays), reapplyAfterDays: Number(f.reapplyAfterDays) },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-admin", slug] });
      qc.invalidateQueries({ queryKey: ["public-tenant", slug] });
      toast("تنظیمات ذخیره شد.");
    },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card title="هویت بصری">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام نمایشی">{(p) => <Input {...p} value={f.displayName} onChange={set("displayName")} />}</Field>
          <Field label="رنگ اصلی" hint="برای پنل‌های دانشجو و استاد">
            {(p) => (
              <div className="flex gap-2">
                <input type="color" aria-label="انتخاب رنگ" value={f.primaryColor} onChange={set("primaryColor")} className="h-10 w-12 cursor-pointer rounded border border-border" />
                <Input {...p} dir="ltr" value={f.primaryColor} onChange={set("primaryColor")} pattern="#[0-9a-fA-F]{6}" />
              </div>
            )}
          </Field>
        </div>
      </Card>
      <Card title="تقویم و امنیت">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تقویم">
            {(p) => (
              <Select {...p} value={f.calendar} onChange={set("calendar")}>
                <option value="jalali">شمسی</option>
                <option value="gregorian">میلادی</option>
              </Select>
            )}
          </Field>
          <Field label="حداقل طول رمز عبور">{(p) => <Input {...p} type="number" min={8} max={64} dir="ltr" value={f.minLength} onChange={set("minLength")} />}</Field>
        </div>
      </Card>
      <Card title="عضویت">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مهلت پیش‌فرض اصلاح (روز)">{(p) => <Input {...p} type="number" min={1} max={60} dir="ltr" value={f.revisionDeadlineDays} onChange={set("revisionDeadlineDays")} />}</Field>
          <Field label="فاصله درخواست مجدد پس از رد (روز)">{(p) => <Input {...p} type="number" min={0} max={365} dir="ltr" value={f.reapplyAfterDays} onChange={set("reapplyAfterDays")} />}</Field>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={save.isPending}>ذخیره تنظیمات</Button>
        {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      </div>
    </form>
  );
}
