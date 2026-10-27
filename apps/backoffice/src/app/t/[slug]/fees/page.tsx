"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ReceiptText } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtRial, toFaDigits } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select } from "@uni/shared/ui/field";
import { Card, PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { DateTimeInput } from "@/components/news/date-time";
import { useSlug } from "@/lib/hooks";

interface Fee {
  id: string;
  serviceKey: string;
  title: string;
  amount: number;
  effectiveFrom: string;
  version: number;
}

interface GatewayView {
  adapters: { key: string; label: string }[];
  config: { adapter: string; merchantId: string | null; hasSecret: boolean; active: boolean; updatedAt: string } | null;
}

/** Tariffs (PAY-10) and the university's gateway account (PAY-03). */
export default function FeesPage() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["fees", slug], queryFn: () => api<Fee[]>("/v1/admin/fees", { tenant: slug }) });
  const [editing, setEditing] = useState<Partial<Fee> | null>(null);
  const now = Date.now();
  // the version in force per service: latest effective date that has passed
  const current = new Map<string, string>();
  for (const f of [...(q.data ?? [])].sort((a, b) => +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom))) {
    if (!current.has(f.serviceKey) && +new Date(f.effectiveFrom) <= now) current.set(f.serviceKey, f.id);
  }
  return (
    <>
      <PageHeader
        eyebrow="امور مالی"
        title="تعرفه‌ها و درگاه"
        description="تغییر تعرفه نسخه جدید می‌سازد و فقط روی درخواست‌های بعد از تاریخ اعمال اثر دارد."
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus aria-hidden className="size-4" />
            تعرفه جدید
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={ReceiptText} title="هنوز تعرفه‌ای تعریف نشده" description="هزینه مرحله‌های پرداخت گردش‌کار از این تعرفه‌ها خوانده می‌شود." />}>
          {(list) => (
            <Table caption="تعرفه‌ها">
              <thead>
                <tr>
                  <Th>کد خدمت</Th>
                  <Th>عنوان</Th>
                  <Th>مبلغ</Th>
                  <Th>نسخه</Th>
                  <Th>اعمال از</Th>
                  <Th><span className="sr-only">اقدام</span></Th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id} className={current.get(f.serviceKey) === f.id ? "" : "text-muted-foreground"}>
                    <Td><span dir="ltr" className="font-mono">{f.serviceKey}</span></Td>
                    <Td>{f.title}</Td>
                    <Td className="whitespace-nowrap font-semibold">{fmtRial(f.amount)}</Td>
                    <Td>
                      {toFaDigits(String(f.version))} {current.get(f.serviceKey) === f.id ? <Badge tone="success">جاری</Badge> : +new Date(f.effectiveFrom) > now ? <Badge tone="info">آینده</Badge> : null}
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(f.effectiveFrom)}</Td>
                    <Td>
                      {current.get(f.serviceKey) === f.id && (
                        <Button size="sm" variant="secondary" onClick={() => setEditing({ serviceKey: f.serviceKey, title: f.title, amount: f.amount })}>
                          تغییر مبلغ
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryView>
        <GatewayCard />
      </div>
      <FeeDialog initial={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function FeeDialog({ initial, onClose }: { initial: Partial<Fee> | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ serviceKey: "", title: "", amount: "", effectiveFrom: null as string | null });
  const [last, setLast] = useState(initial);
  if (initial !== last) {
    setLast(initial);
    if (initial) setV({ serviceKey: initial.serviceKey ?? "", title: initial.title ?? "", amount: initial.amount ? String(initial.amount) : "", effectiveFrom: null });
  }
  const amount = Number(v.amount.replace(/[^\d]/g, ""));
  return (
    <FormDialog
      open={!!initial}
      onClose={onClose}
      title={initial?.serviceKey ? `نسخه جدید «${initial.title}»` : "تعرفه جدید"}
      submitLabel="ثبت تعرفه"
      onSubmit={async () => {
        await api("/v1/admin/fees", { method: "POST", tenant: slug, body: { serviceKey: v.serviceKey.trim(), title: v.title.trim(), amount, effectiveFrom: v.effectiveFrom ?? undefined } });
        await qc.invalidateQueries({ queryKey: ["fees", slug] });
        toast("تعرفه ثبت شد.");
      }}
    >
      <Field label="کد خدمت" required hint="همان کدی که در مرحله پرداخت گردش‌کار وارد می‌شود؛ مثل thesis.defense">
        {(p) => <Input {...p} dir="ltr" value={v.serviceKey} disabled={!!initial?.serviceKey} onChange={(e) => setV({ ...v, serviceKey: e.target.value })} />}
      </Field>
      <Field label="عنوان" required>
        {(p) => <Input {...p} value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} />}
      </Field>
      <Field label="مبلغ (ریال)" required hint={amount ? fmtRial(amount) : "عدد صحیح به ریال"}>
        {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^\d]/g, "") })} />}
      </Field>
      <Field label="اعمال از" hint="خالی یعنی از همین حالا.">
        {(p) => <DateTimeInput id={p.id} value={v.effectiveFrom} onChange={(x) => setV({ ...v, effectiveFrom: x })} />}
      </Field>
    </FormDialog>
  );
}

function GatewayCard() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const g = useQuery({ queryKey: ["payment-gateway", slug], queryFn: () => api<GatewayView>("/v1/admin/payment-gateway", { tenant: slug }) });
  const [v, setV] = useState<{ adapter: string; merchantId: string; secret: string; active: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const cfg = g.data?.config;
  const form = v ?? { adapter: cfg?.adapter ?? g.data?.adapters[0]?.key ?? "", merchantId: cfg?.merchantId ?? "", secret: "", active: cfg?.active ?? true };
  const save = async () => {
    setSaving(true);
    try {
      await api("/v1/admin/payment-gateway", { method: "PUT", tenant: slug, body: { ...form, secret: form.secret || undefined, merchantId: form.merchantId || undefined } });
      await qc.invalidateQueries({ queryKey: ["payment-gateway", slug] });
      setV(null);
      toast("تنظیمات درگاه ذخیره شد.");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="درگاه پرداخت">
      <QueryView query={g}>
        {(d) => (
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            {d.adapters.length === 0 && <p className="text-sm text-danger sm:col-span-2">هیچ درگاهی روی این سرور نصب نیست؛ درگاه بانک پس از عقد قرارداد اضافه می‌شود.</p>}
            <Field label="درگاه">
              {(p) => (
                <Select {...p} value={form.adapter} onChange={(e) => setV({ ...form, adapter: e.target.value })}>
                  {d.adapters.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="شناسه پذیرنده (Merchant ID)">{(p) => <Input {...p} dir="ltr" value={form.merchantId} onChange={(e) => setV({ ...form, merchantId: e.target.value })} />}</Field>
            <Field label="کلید محرمانه" hint={cfg?.hasSecret ? "ذخیره شده است؛ برای تغییر مقدار جدید وارد کنید." : "به‌صورت رمزنگاری‌شده ذخیره می‌شود و دوباره نمایش داده نمی‌شود."}>
              {(p) => <Input {...p} dir="ltr" type="password" autoComplete="off" value={form.secret} onChange={(e) => setV({ ...form, secret: e.target.value })} />}
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox label="درگاه فعال است" checked={form.active} onChange={(e) => setV({ ...form, active: e.target.checked })} />
            </div>
            <div className="sm:col-span-2">
              <Button loading={saving} disabled={!d.adapters.length} onClick={() => void save()}>ذخیره تنظیمات درگاه</Button>
              {cfg && <p className="mt-2 text-xs text-muted-foreground">آخرین تغییر: {fmtDateTime(cfg.updatedAt)}</p>}
            </div>
          </div>
        )}
      </QueryView>
    </Card>
  );
}
