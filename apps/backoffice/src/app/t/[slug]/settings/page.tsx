"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { api, errorMessage } from "@uni/shared/api";
import { useSlug } from "@/lib/hooks";
import type { Tenant, TenantSettings } from "@uni/shared/types";

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
    membershipDocsDays: settings.retention?.membershipDocsDays ? String(settings.retention.membershipDocsDays) : "",
  });
  const [logoFileId, setLogoFileId] = useState<string | undefined>(settings.branding?.logoFileId);
  const save = useMutation({
    mutationFn: () =>
      api("/v1/admin/tenant/settings", {
        method: "PATCH",
        tenant: slug,
        body: {
          calendar: f.calendar,
          branding: { ...settings.branding, logoFileId, displayName: f.displayName || undefined, primaryColor: f.primaryColor },
          passwordPolicy: { minLength: Number(f.minLength) },
          membership: { revisionDeadlineDays: Number(f.revisionDeadlineDays), reapplyAfterDays: Number(f.reapplyAfterDays) },
          retention: f.membershipDocsDays ? { membershipDocsDays: Number(f.membershipDocsDays) } : {},
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
        <LogoField slug={slug} logoFileId={logoFileId} onChange={setLogoFileId} />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
      <Card title="نگهداری داده">
        <Field label="حذف مدارک هویتی پس از تصمیم نهایی (روز)" hint="خالی یعنی مدارک نگهداری می‌شوند. حداقل ۳۰ روز؛ حذف پس از ۷ روز مهلت از فضای ذخیره پاک می‌شود و در ممیزی ثبت می‌شود.">
          {(p) => <Input {...p} type="number" min={30} max={3650} dir="ltr" placeholder="مثلاً ۳۶۵" value={f.membershipDocsDays} onChange={set("membershipDocsDays")} className="max-w-48" />}
        </Field>
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={save.isPending}>ذخیره تنظیمات</Button>
        {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      </div>
    </form>
  );
}

/** Logo upload (UX-10): PNG/JPG up to 1 MB, shown on the public pages after saving. */
function LogoField({ slug, logoFileId, onChange }: { slug: string; logoFileId?: string; onChange: (id: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const upload = async (file: File) => {
    setError(null);
    if (file.size > 1024 * 1024) return setError("حجم لوگو باید کمتر از ۱ مگابایت باشد.");
    const fd = new FormData();
    fd.set("purpose", "branding_logo");
    fd.set("file", file);
    setPending(true);
    try {
      const row = await api<{ id: string }>("/v1/files", { method: "POST", tenant: slug, body: fd });
      onChange(row.id);
      setPreview(URL.createObjectURL(file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  const src = preview ?? (logoFileId ? `/api/proxy/v1/public/tenants/${slug}/logo?v=${logoFileId}` : null);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="لوگوی فعلی" className="max-h-full max-w-full object-contain p-2" /> : <span className="text-xs text-muted-foreground">بدون لوگو</span>}
      </div>
      <div className="flex flex-col gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" id="logo-upload" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={pending} onClick={() => input.current?.click()}>
            <ImagePlus aria-hidden className="size-4" />
            {logoFileId ? "تغییر لوگو" : "بارگذاری لوگو"}
          </Button>
          {logoFileId && (
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => { onChange(undefined); setPreview(null); }}>
              <Trash2 aria-hidden className="size-4" />
              حذف
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PNG یا JPG مربعی، حداکثر ۱ مگابایت. پس از «ذخیره تنظیمات» نمایش داده می‌شود.</p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
