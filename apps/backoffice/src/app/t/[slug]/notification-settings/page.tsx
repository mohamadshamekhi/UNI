"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Lock, Mail, MessageSquare, Pencil, RotateCcw, ShieldAlert, Smartphone, type LucideIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtNum } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { Card, PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { useSlug } from "@/lib/hooks";

type Channel = "inapp" | "sms" | "email";

interface EventSettings {
  event: string;
  label: string;
  critical: boolean;
  variables: { key: string; label: string; sensitive: boolean }[];
  rules: { recipient: string; defaultChannels: Channel[]; channels: Channel[]; enabled: boolean; customised: boolean }[];
  templates: { channel: Channel; default: { subject?: string; body: string } | null; override: { subject: string | null; body: string; updatedAt: string } | null }[];
}

interface Delivery {
  id: string;
  event: string;
  channel: Channel;
  status: "queued" | "sent" | "delivered" | "failed" | "dead" | "skipped";
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  recipientName: string;
  recipient: string;
}

const CHANNEL: Record<Channel, { label: string; icon: LucideIcon }> = {
  inapp: { label: "درون سامانه", icon: MessageSquare },
  sms: { label: "پیامک", icon: Smartphone },
  email: { label: "ایمیل", icon: Mail },
};
const RECIPIENT: Record<string, string> = { user: "کاربر", applicant: "متقاضی", assignee: "مسئول مرحله" };
const STATUS: Record<Delivery["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  queued: { label: "در صف", tone: "info" },
  sent: { label: "ارسال‌شده", tone: "success" },
  delivered: { label: "تحویل‌شده", tone: "success" },
  failed: { label: "ناموفق", tone: "warning" },
  dead: { label: "ناموفق نهایی", tone: "danger" },
  skipped: { label: "ارسال نشد", tone: "neutral" },
};
const ERRORS: Record<string, string> = {
  sms_quota_exceeded: "سقف ماهانه پیامک",
  email_channel_not_configured: "کانال ایمیل راه‌اندازی نشده",
  recipient_missing: "گیرنده پیدا نشد",
};
const PROBLEMS = (p: string) => {
  const [code, v] = p.split(":");
  if (code === "unknown_variable") return `متغیر «${v}» برای این رویداد تعریف نشده است.`;
  if (code === "sensitive_variable") return `متغیر محرمانه «${v}» فقط در اعلان درون سامانه مجاز است.`;
  if (code === "sms_too_long") return "متن پیامک بیش از ۲۸۰ نویسه است.";
  return p;
};

function SettingsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") === "deliveries" ? "deliveries" : "templates";
  return (
    <>
      <PageHeader eyebrow="سامانه" title="اعلان‌ها" description="چه کسی، از چه کانالی و با چه متنی از رویدادها باخبر شود؛ و گزارش ارسال پیام‌ها." />
      <div role="tablist" aria-label="بخش‌ها" className="mb-5 inline-flex rounded-full bg-muted p-1 text-sm">
        {[
          ["templates", "قالب‌ها و قواعد"],
          ["deliveries", "گزارش ارسال"],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => router.replace(`?tab=${k}`)}
            className={clsx("cursor-pointer rounded-full px-4 py-1.5 transition-colors", tab === k ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "templates" ? <Templates /> : <Deliveries />}
    </>
  );
}

function Templates() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["ntf-templates", slug], queryFn: () => api<EventSettings[]>("/v1/admin/notification-templates", { tenant: slug }) });
  const [editing, setEditing] = useState<{ ev: EventSettings; channel: Channel } | null>(null);
  return (
    <QueryView query={q}>
      {(events) => (
        <div className="flex flex-col gap-4">
          {events.map((ev) => (
            <EventCard key={ev.event} ev={ev} onEdit={(channel) => setEditing({ ev, channel })} />
          ))}
          <TemplateDialog target={editing} onClose={() => setEditing(null)} />
        </div>
      )}
    </QueryView>
  );
}

function EventCard({ ev, onEdit }: { ev: EventSettings; onEdit: (c: Channel) => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const saveRule = async (r: EventSettings["rules"][number], patch: Partial<{ channels: Channel[]; enabled: boolean }>) => {
    try {
      await api("/v1/admin/notification-rules", { method: "PUT", tenant: slug, body: { event: ev.event, recipient: r.recipient, channels: patch.channels ?? r.channels, enabled: patch.enabled ?? r.enabled } });
      qc.invalidateQueries({ queryKey: ["ntf-templates", slug] });
      toast("قاعده ذخیره شد.");
    } catch (e) {
      toast(errorMessage(e));
    }
  };
  const reset = async (channel: Channel) => {
    try {
      await api(`/v1/admin/notification-templates/${ev.event}/${channel}`, { method: "DELETE", tenant: slug });
      qc.invalidateQueries({ queryKey: ["ntf-templates", slug] });
      toast("متن پیش‌فرض برگشت.");
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <Card
      title={ev.label}
      actions={
        <div className="flex items-center gap-2">
          {ev.critical && (
            <Badge tone="warning">
              <ShieldAlert aria-hidden className="size-3" /> حیاتی
            </Badge>
          )}
          <code dir="ltr" className="text-xs text-muted-foreground">{ev.event}</code>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {ev.rules.map((r) => (
          <div key={r.recipient} className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="w-28 text-sm font-semibold">{RECIPIENT[r.recipient] ?? r.recipient}</p>
            <Checkbox label="فعال" checked={r.enabled} onChange={(e) => saveRule(r, { enabled: e.target.checked })} />
            {(Object.keys(CHANNEL) as Channel[]).map((c) => (
              <Checkbox
                key={c}
                label={CHANNEL[c].label}
                disabled={!r.enabled}
                checked={r.channels.includes(c)}
                onChange={(e) => saveRule(r, { channels: e.target.checked ? [...r.channels, c] : r.channels.filter((x) => x !== c) })}
              />
            ))}
            {r.customised && <Badge tone="info">سفارشی</Badge>}
          </div>
        ))}

        <div className="grid gap-3 md:grid-cols-3">
          {ev.templates.map((t) => {
            const text = t.override ?? t.default;
            const Icon = CHANNEL[t.channel].icon;
            return (
              <div key={t.channel} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Icon aria-hidden className="size-4 text-primary" />
                    {CHANNEL[t.channel].label}
                  </span>
                  {t.override ? <Badge tone="info">سفارشی</Badge> : t.default ? <Badge>پیش‌فرض</Badge> : <Badge>بدون متن</Badge>}
                </div>
                {text ? (
                  <p className="line-clamp-4 text-xs leading-6 text-muted-foreground">
                    {text.subject && <span className="block font-semibold text-foreground">{text.subject}</span>}
                    {text.body}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">برای این کانال متنی تعریف نشده است.</p>
                )}
                <div className="mt-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(t.channel)}>
                    <Pencil aria-hidden className="size-3.5" />
                    ویرایش
                  </Button>
                  {t.override && (
                    <Button size="sm" variant="ghost" onClick={() => reset(t.channel)}>
                      <RotateCcw aria-hidden className="size-3.5" />
                      پیش‌فرض
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** Template editor with variable chips and a live preview that runs the server-side checks. */
function TemplateDialog({ target, onClose }: { target: { ev: EventSettings; channel: Channel } | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ problems: string[]; subject: string | null; body: string } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [last, setLast] = useState(target);
  if (target !== last) {
    setLast(target);
    if (target) {
      const t = target.ev.templates.find((x) => x.channel === target.channel)!;
      const text = t.override ?? t.default;
      setSubject(text?.subject ?? "");
      setBody(text?.body ?? "");
      setPreview(null);
    }
  }
  useEffect(() => {
    if (!target || !body.trim()) return;
    const h = setTimeout(() => {
      api<{ problems: string[]; subject: string | null; body: string }>("/v1/admin/notification-templates/preview", {
        method: "POST",
        tenant: slug,
        body: { event: target.ev.event, channel: target.channel, subject: subject || undefined, body },
      })
        .then(setPreview)
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(h);
  }, [target, subject, body, slug]);

  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: a, selectionEnd: b } = el;
    setBody((v) => v.slice(0, a) + token + v.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  const outside = target?.channel !== "inapp";
  return (
    <FormDialog
      open={!!target}
      onClose={onClose}
      wide
      title={target ? `${target.ev.label} — ${CHANNEL[target.channel].label}` : ""}
      submitLabel="ذخیره متن"
      onSubmit={async () => {
        await api("/v1/admin/notification-templates", {
          method: "PUT",
          tenant: slug,
          body: { event: target!.ev.event, channel: target!.channel, subject: subject.trim() || undefined, body: body.trim() },
        });
        qc.invalidateQueries({ queryKey: ["ntf-templates", slug] });
        toast("متن اعلان ذخیره شد.");
      }}
    >
      {target && (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">متغیرها</p>
            <div className="flex flex-wrap gap-2">
              {target.ev.variables.map((v) => {
                const blocked = v.sensitive && outside;
                return (
                  <button
                    key={v.key}
                    type="button"
                    disabled={blocked}
                    title={blocked ? "محرمانه؛ فقط در اعلان درون سامانه" : undefined}
                    onClick={() => insert(v.key)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {v.sensitive && <Lock aria-hidden className="size-3" />}
                    {v.label}
                    <code dir="ltr" className="opacity-60">{`{{${v.key}}}`}</code>
                  </button>
                );
              })}
            </div>
          </div>
          {target.channel !== "sms" && (
            <Field label={target.channel === "inapp" ? "عنوان" : "موضوع"}>
              {(p) => <Input {...p} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}
            </Field>
          )}
          <Field label="متن" required hint={target.channel === "sms" ? `${fmtNum(body.length)} از ۲۸۰ نویسه` : undefined}>
            {(p) => <Textarea {...p} ref={ref} className="min-h-28" value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          {preview && (
            <div className="rounded-xl bg-muted p-4">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">پیش‌نمایش با داده نمونه</p>
              {preview.subject && <p className="font-semibold">{preview.subject}</p>}
              <p className="text-sm leading-7 whitespace-pre-line">{preview.body}</p>
              {preview.problems.length > 0 && (
                <ul role="alert" className="mt-3 flex flex-col gap-1 text-sm text-danger">
                  {preview.problems.map((p) => (
                    <li key={p}>{PROBLEMS(p)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </FormDialog>
  );
}

function Deliveries() {
  const slug = useSlug();
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["ntf-deliveries", slug, status, channel, offset],
    queryFn: () =>
      api<{ items: Delivery[]; total: number; sms: { sentThisMonth: number; monthlyQuota: number | null; nearQuota: boolean } }>("/v1/admin/notification-deliveries", {
        tenant: slug,
        query: { status: status || undefined, channel: channel || undefined, limit: 25, offset },
      }),
  });
  return (
    <div className="flex flex-col gap-4">
      {q.data && (
        <div className={clsx("flex flex-wrap items-center gap-4 rounded-2xl border p-4", q.data.sms.nearQuota ? "border-warning/40 bg-warning-bg" : "border-border bg-card")}>
          <span className="flex size-11 items-center justify-center rounded-xl bg-info-bg text-primary">
            <Smartphone aria-hidden className="size-5" />
          </span>
          <div className="text-sm">
            <p className="font-semibold">
              پیامک‌های این ماه: <span className="tabular">{fmtNum(q.data.sms.sentThisMonth)}</span>
              {q.data.sms.monthlyQuota !== null && <> از <span className="tabular">{fmtNum(q.data.sms.monthlyQuota)}</span></>}
            </p>
            <p className="text-xs text-muted-foreground">{q.data.sms.monthlyQuota === null ? "سقف ماهانه تعیین نشده است." : q.data.sms.nearQuota ? "به سقف ماهانه نزدیک شده‌اید؛ پس از آن پیامک غیرحیاتی ارسال نمی‌شود." : "سقف ماهانه را مدیر کل سامانه تعیین می‌کند."}</p>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="وضعیت">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => (setStatus(e.target.value), setOffset(0))}>
              <option value="">همه</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="کانال">
          {(p) => (
            <Select {...p} value={channel} onChange={(e) => (setChannel(e.target.value), setOffset(0))}>
              <option value="">همه</option>
              {Object.entries(CHANNEL).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <QueryView query={q} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="پیامی با این فیلترها نیست" />}>
        {(d) => (
          <>
            <Table caption="گزارش ارسال">
              <thead>
                <tr>
                  <Th>رویداد</Th>
                  <Th>گیرنده</Th>
                  <Th>کانال</Th>
                  <Th>وضعیت</Th>
                  <Th>تلاش</Th>
                  <Th>زمان</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((r) => (
                  <tr key={r.id}>
                    <Td><code dir="ltr" className="text-xs">{r.event}</code></Td>
                    <Td>
                      {r.recipientName}
                      <span className="block text-xs text-muted-foreground tabular" dir="ltr">{r.recipient}</span>
                    </Td>
                    <Td>{CHANNEL[r.channel].label}</Td>
                    <Td>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      {r.error && <span className="mt-1 block max-w-48 truncate text-xs text-muted-foreground" title={r.error}>{ERRORS[r.error] ?? r.error}</span>}
                    </Td>
                    <Td className="tabular">{fmtNum(r.attempts)}</Td>
                    <Td className="tabular whitespace-nowrap">{fmtDateTime(r.sentAt ?? r.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <nav aria-label="صفحه‌بندی" className="flex items-center justify-between">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>قبلی</Button>
              <span className="text-xs text-muted-foreground tabular">{fmtNum(offset + 1)}–{fmtNum(Math.min(offset + 25, d.total))} از {fmtNum(d.total)}</span>
              <Button size="sm" variant="secondary" disabled={offset + 25 >= d.total} onClick={() => setOffset(offset + 25)}>بعدی</Button>
            </nav>
          </>
        )}
      </QueryView>
    </div>
  );
}

export default function NotificationSettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
