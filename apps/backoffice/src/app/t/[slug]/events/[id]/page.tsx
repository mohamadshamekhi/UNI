"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, ImagePlus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useId, useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtNum, fmtRial } from "@uni/shared/format";
import { EVENT_STATUS, EVENT_VISIBILITY, REGISTRATION_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select } from "@uni/shared/ui/field";
import { Card, PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { EventStatus, EventVisibility, FormFieldDef, RegistrationRule, RegistrationStatus, Role } from "@uni/shared/types";
import { DateTimeInput } from "@/components/news/date-time";
import { RichText } from "@/components/news/rich-text";
import { uploadFile } from "@/components/news/upload";
import { FormBuilder } from "@/components/workflow/step-editor";
import { useSlug, useUnits } from "@/lib/hooks";

interface EventRow {
  id: string;
  title: string;
  descriptionHtml: string | null;
  category: string | null;
  organizer: string | null;
  organizerUnitId: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  onlineUrl: string | null;
  coverFileId: string | null;
  status: EventStatus;
  visibility: EventVisibility;
  visibleTenantIds: string[];
  registrationRule: RegistrationRule;
  capacity: number | null;
  waitlist: boolean;
  registrationDeadline: string | null;
  requiresApproval: boolean;
  allowCancel: boolean;
  form: FormFieldDef[];
  feeAmount: number | null;
  counts: Partial<Record<RegistrationStatus, number>>;
}

interface Registration {
  id: string;
  status: RegistrationStatus;
  code: string;
  fullName: string;
  mobile: string | null;
  homeTenant: string | null;
  answers: Record<string, unknown>;
  attendedAt: string | null;
  createdAt: string;
}

type RuleKind = "members" | "authenticated" | "units" | "roles" | "tenants";

const blank = (): Omit<EventRow, "id" | "status" | "counts"> => {
  const start = new Date(Date.now() + 7 * 86_400_000);
  start.setHours(10, 0, 0, 0);
  return {
    title: "",
    descriptionHtml: "",
    category: "",
    organizer: "",
    organizerUnitId: null,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    location: "",
    onlineUrl: "",
    coverFileId: null,
    visibility: "own_tenant",
    visibleTenantIds: [],
    registrationRule: { members: true },
    capacity: null,
    waitlist: true,
    registrationDeadline: null,
    requiresApproval: false,
    allowCancel: true,
    form: [],
    feeAmount: null,
  };
};

const NEXT: Partial<Record<EventStatus, { to: EventStatus; label: string }[]>> = {
  draft: [
    { to: "registration_open", label: "انتشار و باز کردن ثبت‌نام" },
    { to: "published", label: "فقط اعلام (بدون ثبت‌نام)" },
  ],
  published: [{ to: "registration_open", label: "باز کردن ثبت‌نام" }, { to: "held", label: "برگزار شد" }],
  registration_open: [{ to: "registration_closed", label: "بستن ثبت‌نام" }, { to: "held", label: "برگزار شد" }],
  registration_closed: [{ to: "registration_open", label: "بازگشایی ثبت‌نام" }, { to: "held", label: "برگزار شد" }],
};

/** Event editor, status, registrations, attendance and export (EVT-01..08). */
export default function EventAdminPage() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["event-admin", slug, id], enabled: !isNew, queryFn: () => api<EventRow>(`/v1/admin/events/${id}`, { tenant: slug }) });
  if (isNew) return <EventEditor />;
  return <QueryView query={q}>{(e) => <EventEditor key={`${e.id}:${e.status}`} event={e} />}</QueryView>;
}

function EventEditor({ event }: { event?: EventRow }) {
  const slug = useSlug();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const descId = useId();
  const { flat } = useUnits(slug);
  const roles = useQuery({ queryKey: ["roles", slug], queryFn: () => api<Role[]>("/v1/admin/roles", { tenant: slug }), retry: false });
  const partners = useQuery({ queryKey: ["event-partners", slug], queryFn: () => api<{ id: string; nameFa: string }[]>("/v1/admin/event-partner-tenants", { tenant: slug }) });
  const [v, setV] = useState(() => (event ? { ...blank(), ...event, descriptionHtml: event.descriptionHtml ?? "", category: event.category ?? "", organizer: event.organizer ?? "", location: event.location ?? "", onlineUrl: event.onlineUrl ?? "" } : blank()));
  const [tab, setTab] = useState<"details" | "registrations">("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const rule = v.registrationRule;
  const ruleKind: RuleKind = rule.authenticated ? "authenticated" : rule.units?.length || rule.units ? "units" : rule.roles ? "roles" : rule.tenants ? "tenants" : "members";
  const closed = event && (event.status === "held" || event.status === "cancelled");
  const refresh = () => qc.invalidateQueries({ queryKey: ["event-admin", slug, event!.id] });

  const save = async () => {
    if (!v.title.trim()) return setError("عنوان رویداد را بنویسید.");
    setSaving(true);
    setError(null);
    const body = {
      title: v.title.trim(),
      descriptionHtml: v.descriptionHtml ?? "",
      category: v.category ?? "",
      organizer: v.organizer ?? "",
      organizerUnitId: v.organizerUnitId,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      location: v.location ?? "",
      onlineUrl: v.onlineUrl ?? "",
      coverFileId: v.coverFileId,
      visibility: v.visibility,
      visibleTenantIds: v.visibleTenantIds,
      registrationRule: v.registrationRule,
      capacity: v.capacity,
      waitlist: v.waitlist,
      registrationDeadline: v.registrationDeadline,
      requiresApproval: v.requiresApproval,
      allowCancel: v.allowCancel,
      form: v.form,
      feeAmount: v.feeAmount,
    };
    try {
      if (!event) {
        const e = await api<{ id: string }>("/v1/admin/events", { method: "POST", tenant: slug, body });
        toast("رویداد به‌صورت پیش‌نویس ذخیره شد.");
        router.replace(`/t/${slug}/events/${e.id}`);
      } else {
        await api(`/v1/admin/events/${event.id}`, { method: "PATCH", tenant: slug, body });
        toast("ذخیره شد.");
        await refresh();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const move = async (to: EventStatus, reason?: string) => {
    await api(`/v1/admin/events/${event!.id}/status`, { method: "POST", tenant: slug, body: { status: to, reason } });
    toast(`وضعیت: ${EVENT_STATUS[to].label}`);
    qc.invalidateQueries({ queryKey: ["events-admin", slug] });
    await refresh();
  };

  const setRuleKind = (k: RuleKind) =>
    set({ registrationRule: k === "members" ? { members: true } : k === "authenticated" ? { authenticated: true } : k === "units" ? { units: [] } : k === "roles" ? { roles: [] } : { tenants: [] } });

  return (
    <>
      <Link href={`/t/${slug}/events`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        رویدادها
      </Link>
      <PageHeader
        eyebrow="رویداد"
        title={event?.title || "رویداد جدید"}
        actions={event && <Badge tone={EVENT_STATUS[event.status].tone}>{EVENT_STATUS[event.status].label}</Badge>}
      />
      {event && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(NEXT[event.status] ?? []).map((n) => (
            <Button key={n.to} variant={n.to === "registration_open" ? "primary" : "secondary"} onClick={() => void move(n.to).catch((e) => toast(errorMessage(e)))}>
              {n.label}
            </Button>
          ))}
          {!closed && (
            <Button variant="ghost" className="text-danger" onClick={() => setCancelOpen(true)}>
              لغو رویداد
            </Button>
          )}
          <div role="tablist" aria-label="بخش‌ها" className="ms-auto flex gap-1 rounded-full bg-muted/60 p-1">
            {(["details", "registrations"] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-9 cursor-pointer rounded-full px-4 text-sm ${tab === t ? "bg-card font-semibold shadow-sm" : ""}`}>
                {t === "details" ? "مشخصات" : `ثبت‌نام‌ها (${fmtNum(Object.entries(event.counts).filter(([s]) => s !== "cancelled").reduce((a, [, n]) => a + (n ?? 0), 0))})`}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "registrations" && event ? (
        <Registrations event={event} />
      ) : (
        <fieldset disabled={!!closed} className="grid gap-5 xl:grid-cols-2">
          <Card title="اطلاعات رویداد" className="xl:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="عنوان" required className="sm:col-span-2">{(p) => <Input {...p} value={v.title} maxLength={300} onChange={(e) => set({ title: e.target.value })} />}</Field>
              <Field label="دسته‌بندی">{(p) => <Input {...p} value={v.category ?? ""} maxLength={60} placeholder="همایش، کارگاه، نشست…" onChange={(e) => set({ category: e.target.value })} />}</Field>
              <Field label="برگزارکننده">{(p) => <Input {...p} value={v.organizer ?? ""} maxLength={200} onChange={(e) => set({ organizer: e.target.value })} />}</Field>
              <Field label="واحد برگزارکننده" hint="مسئولان رویداد همین واحد آن را مدیریت می‌کنند.">
                {(p) => (
                  <Select {...p} value={v.organizerUnitId ?? ""} onChange={(e) => set({ organizerUnitId: e.target.value || null })}>
                    <option value="">کل دانشگاه</option>
                    {flat.map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <div />
              <Field label="شروع" required>{(p) => <DateTimeInput id={p.id} value={v.startsAt} onChange={(x) => x && set({ startsAt: x })} />}</Field>
              <Field label="پایان" required>{(p) => <DateTimeInput id={p.id} value={v.endsAt} onChange={(x) => x && set({ endsAt: x })} />}</Field>
              <Field label="مکان">{(p) => <Input {...p} value={v.location ?? ""} maxLength={300} onChange={(e) => set({ location: e.target.value })} />}</Field>
              <Field label="پیوند برخط" hint="فقط به ثبت‌نام‌شدگان نمایش داده می‌شود.">{(p) => <Input {...p} dir="ltr" type="url" value={v.onlineUrl ?? ""} maxLength={500} onChange={(e) => set({ onlineUrl: e.target.value })} />}</Field>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span id={descId} className="text-sm font-medium">توضیحات</span>
                <RichText id={`${descId}-body`} labelledBy={descId} value={v.descriptionHtml ?? ""} onChange={(html) => set({ descriptionHtml: html })} />
              </div>
              <div className="sm:col-span-2">
                {v.coverFileId ? (
                  <span className="inline-flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                    <ImagePlus aria-hidden className="size-4" />
                    تصویر رویداد انتخاب شده
                    <button type="button" aria-label="حذف تصویر" onClick={() => set({ coverFileId: null })} className="grid size-7 cursor-pointer place-items-center rounded-lg hover:bg-card">
                      <X aria-hidden className="size-4" />
                    </button>
                  </span>
                ) : (
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 text-sm hover:border-primary/50">
                    <ImagePlus aria-hidden className="size-4" />
                    تصویر رویداد
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadFile(slug, f, "news_image").then((m) => set({ coverFileId: m.id }), (err) => toast(errorMessage(err)));
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          </Card>

          <Card title="چه کسانی رویداد را می‌بینند؟">
            <div className="flex flex-col gap-3">
              {(Object.keys(EVENT_VISIBILITY) as EventVisibility[]).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input type="radio" name="visibility" checked={v.visibility === k} onChange={() => set({ visibility: k })} />
                  {EVENT_VISIBILITY[k]}
                </label>
              ))}
              {v.visibility === "selected_tenants" && (
                <div className="flex flex-col gap-1.5 rounded-xl bg-muted/50 p-3">
                  {partners.data?.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.nameFa}
                      checked={v.visibleTenantIds.includes(t.id)}
                      onChange={(e) => set({ visibleTenantIds: e.target.checked ? [...v.visibleTenantIds, t.id] : v.visibleTenantIds.filter((x) => x !== t.id) })}
                    />
                  ))}
                  {partners.data?.length === 0 && <p className="text-sm text-muted-foreground">دانشگاه دیگری در سامانه فعال نیست.</p>}
                </div>
              )}
            </div>
          </Card>

          <Card title="چه کسانی می‌توانند ثبت‌نام کنند؟">
            <div className="flex flex-col gap-3">
              <Select aria-label="قاعده ثبت‌نام" value={ruleKind} onChange={(e) => setRuleKind(e.target.value as RuleKind)}>
                <option value="members">همه اعضای این دانشگاه</option>
                <option value="units">اعضای واحدهای مشخص</option>
                <option value="roles">دارندگان نقش‌های مشخص</option>
                <option value="tenants">اعضای دانشگاه‌های مشخص</option>
                <option value="authenticated">هر کاربر واردشده</option>
              </Select>
              {ruleKind === "units" && (
                <div className="flex flex-col gap-1.5">
                  {flat.map((u) => {
                    const on = rule.units?.some((x) => x.id === u.id);
                    return <Checkbox key={u.id} label={u.label} checked={!!on} onChange={(e) => set({ registrationRule: { units: e.target.checked ? [...(rule.units ?? []), { id: u.id, tree: true }] : (rule.units ?? []).filter((x) => x.id !== u.id) } })} />;
                  })}
                </div>
              )}
              {ruleKind === "roles" && (
                <div className="flex flex-wrap gap-2">
                  {roles.data?.map((r) => {
                    const on = rule.roles?.includes(r.key);
                    return (
                      <button key={r.id} type="button" aria-pressed={on} onClick={() => set({ registrationRule: { roles: on ? rule.roles!.filter((k) => k !== r.key) : [...(rule.roles ?? []), r.key] } })} className={`h-9 cursor-pointer rounded-full border px-3 text-sm ${on ? "border-primary bg-primary text-on-primary" : "border-border"}`}>
                        {r.nameFa}
                      </button>
                    );
                  })}
                </div>
              )}
              {ruleKind === "tenants" && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground">اعضای این دانشگاه همیشه می‌توانند ثبت‌نام کنند؛ دانشگاه‌های دیگر را انتخاب کنید.</p>
                  {partners.data?.map((t) => (
                    <Checkbox key={t.id} label={t.nameFa} checked={!!rule.tenants?.includes(t.id)} onChange={(e) => set({ registrationRule: { members: true, tenants: e.target.checked ? [...(rule.tenants ?? []), t.id] : (rule.tenants ?? []).filter((x) => x !== t.id) } })} />
                  ))}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ظرفیت" hint="خالی یعنی نامحدود.">
                  {(p) => <Input {...p} type="number" dir="ltr" min={1} value={v.capacity ?? ""} onChange={(e) => set({ capacity: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />}
                </Field>
                <Field label="هزینه ثبت‌نام (ریال)" hint={v.feeAmount ? `${fmtRial(v.feeAmount)} — ثبت‌نام پس از پرداخت قطعی می‌شود.` : "خالی یعنی رایگان. تغییر مبلغ فقط روی ثبت‌نام‌های بعدی اثر دارد."}>
                  {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={v.feeAmount ?? ""} onChange={(e) => { const n = Number(e.target.value.replace(/[^\d]/g, "")); set({ feeAmount: n || null }); }} />}
                </Field>
                <Field label="مهلت ثبت‌نام">{(p) => <DateTimeInput id={p.id} value={v.registrationDeadline} onChange={(x) => set({ registrationDeadline: x })} />}</Field>
              </div>
              <Checkbox label="فهرست انتظار پس از تکمیل ظرفیت" checked={v.waitlist} onChange={(e) => set({ waitlist: e.target.checked })} />
              <Checkbox label="ثبت‌نام‌ها نیاز به تأیید برگزارکننده دارند" checked={v.requiresApproval} onChange={(e) => set({ requiresApproval: e.target.checked })} />
              <Checkbox label="شرکت‌کننده بتواند ثبت‌نام را لغو کند" checked={v.allowCancel} onChange={(e) => set({ allowCancel: e.target.checked })} />
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <FormBuilder fields={v.form} onChange={(form) => set({ form })} roles={[]} title="فرم ثبت‌نام" empty="فرم اضافه‌ای لازم نیست؛ نام و تماس از حساب کاربر برداشته می‌شود." allowInternal={false} />
          </Card>

          <div className="flex flex-col gap-2 xl:col-span-2">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {!closed && <Button className="self-start" loading={saving} onClick={() => void save()}>{event ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}</Button>}
          </div>
        </fieldset>
      )}

      {event && (
        <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="لغو رویداد" description="به همه ثبت‌نام‌شدگان اعلان و پیامک ارسال می‌شود." submitLabel="لغو رویداد" onConfirm={(reason) => move("cancelled", reason)} />
      )}
    </>
  );
}

function Registrations({ event }: { event: EventRow }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["event-registrations", slug, event.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Registration[]>(`/v1/admin/events/${event.id}/registrations`, { tenant: slug }) });
  const act = async (path: string, body: unknown) => {
    try {
      await api(`/v1/admin/event-registrations/${path}`, { method: "POST", tenant: slug, body });
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["event-admin", slug, event.id] })]);
    } catch (e) {
      toast(errorMessage(e));
    }
  };
  const active = (s: RegistrationStatus) => s === "registered" || s === "approved" || s === "pending";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {(Object.entries(event.counts) as [RegistrationStatus, number][]).map(([s, n]) => (
          <Badge key={s} tone={REGISTRATION_STATUS[s].tone}>{REGISTRATION_STATUS[s].label}: {fmtNum(n)}</Badge>
        ))}
        {event.capacity && <span className="text-sm text-muted-foreground">ظرفیت {fmtNum(event.capacity)}</span>}
        <a href={`/api/proxy/v1/admin/events/${event.id}/registrations.csv`} onClick={(e) => { e.preventDefault(); void download(slug, event.id).catch((err) => toast(errorMessage(err))); }} className="ms-auto inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted/60">
          <Download aria-hidden className="size-4" />
          خروجی اکسل (CSV)
        </a>
      </div>
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState title="هنوز کسی ثبت‌نام نکرده است" />}>
        {(rows) => (
          <Table caption="ثبت‌نام‌ها">
            <thead>
              <tr>
                <Th>نام</Th>
                <Th>دانشگاه</Th>
                <Th>کد</Th>
                <Th>وضعیت</Th>
                <Th>ثبت</Th>
                <Th>حضور</Th>
                <Th><span className="sr-only">اقدام</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <p className="font-semibold">{r.fullName}</p>
                    {r.mobile && <p dir="ltr" className="text-end text-xs text-muted-foreground">{r.mobile}</p>}
                  </Td>
                  <Td>{r.homeTenant}</Td>
                  <Td><span dir="ltr" className="font-mono">{r.code}</span></Td>
                  <Td><Badge tone={REGISTRATION_STATUS[r.status].tone}>{REGISTRATION_STATUS[r.status].label}</Badge></Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</Td>
                  <Td>
                    {active(r.status) && (
                      <input type="checkbox" aria-label={`حضور ${r.fullName}`} checked={!!r.attendedAt} onChange={(e) => void act(`${r.id}/attendance`, { attended: e.target.checked })} className="size-5 cursor-pointer" />
                    )}
                  </Td>
                  <Td>
                    {r.status === "pending" && (
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void act(`${r.id}/decide`, { approve: true })}>تأیید</Button>
                        <Button size="sm" variant="secondary" onClick={() => void act(`${r.id}/decide`, { approve: false })}>رد</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
    </div>
  );
}

async function download(slug: string, id: string) {
  const res = await fetch(`/api/proxy/v1/admin/events/${id}/registrations.csv`, { headers: { "x-tenant": slug } });
  if (!res.ok) throw new Error("دریافت فایل ممکن نشد.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `registrations-${id.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
