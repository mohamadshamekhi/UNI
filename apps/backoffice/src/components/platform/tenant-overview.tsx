"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarDays, FileText, FolderKanban, GraduationCap, HardDrive, Users, Wallet, type LucideIcon } from "lucide-react";
import { api } from "@uni/shared/api";
import { fmtBytes, fmtDateTime, fmtNum, fmtRial } from "@uni/shared/format";
import { CASE_STATUS, MEMBERSHIP_KIND, MEMBERSHIP_STATUS, PAPER_STATUS, THESIS_STATUS, type Tone } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Card } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";

interface Overview {
  members: { total: number; byStatus: Record<string, number>; activeByKind: Record<string, number> };
  admins: { fullName: string; mobile: string | null; status: string; since: string }[];
  structure: { units: number; roles: number };
  cases: { total: number; byStatus: Record<string, number> };
  theses: { total: number; byStatus: Record<string, number> };
  papers: { total: number; byStatus: Record<string, number> };
  events: { total: number; upcoming: number; registrations: number };
  news: { published: number; channels: number };
  payments: { paid: number; paidCount: number; review: number; open: number };
  storage: { files: number; bytes: number; quota: number | null };
  activity: { lastAt: string | null; actions30d: number; sms30d: number; activeUsers30d: number };
}

type Labels = Record<string, { label: string; tone: Tone }>;

/**
 * What a platform admin sees about one university: aggregate numbers and its administrators. Case,
 * paper and personal record contents stay with the university's own staff.
 */
export function TenantOverview({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: ["platform-tenant-overview", tenantId], queryFn: () => api<Overview>(`/v1/platform/tenants/${tenantId}/overview`) });
  return (
    <QueryView query={q}>
      {(o) => {
        const used = o.storage.quota ? Math.min(100, (o.storage.bytes / o.storage.quota) * 100) : null;
        return (
          <section aria-label="نمای کلی دانشگاه" className="mb-6 flex flex-col gap-4">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi icon={Users} label="اعضای فعال" value={fmtNum(o.members.byStatus.active ?? 0)} hint={o.members.byStatus.pending_review ? `${fmtNum(o.members.byStatus.pending_review)} در انتظار بررسی` : undefined} />
              <Kpi icon={Activity} label="کاربران فعال ۳۰ روز" value={fmtNum(o.activity.activeUsers30d)} hint={o.activity.lastAt ? `آخرین فعالیت ${fmtDateTime(o.activity.lastAt)}` : "بدون فعالیت"} />
              <Kpi icon={Wallet} label="دریافتی کل" value={fmtRial(o.payments.paid)} hint={o.payments.review ? `${fmtNum(o.payments.review)} پرداخت در انتظار بررسی` : `${fmtNum(o.payments.paidCount)} پرداخت موفق`} />
              <Kpi
                icon={HardDrive}
                label="فضای ذخیره"
                value={fmtBytes(o.storage.bytes)}
                hint={`${fmtNum(o.storage.files)} فایل${o.storage.quota ? ` از سهمیه ${fmtBytes(o.storage.quota)}` : ""}`}
                bar={used}
              />
            </ul>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="اعضا">
                <Rows rows={Object.entries(o.members.activeByKind).map(([k, n]) => [MEMBERSHIP_KIND[k as keyof typeof MEMBERSHIP_KIND] ?? k, n])} empty="عضو فعالی ندارد" />
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {Object.entries(o.members.byStatus).map(([s, n]) => (
                    <Badge key={s} tone={(MEMBERSHIP_STATUS as Labels)[s]?.tone ?? "neutral"}>
                      {(MEMBERSHIP_STATUS as Labels)[s]?.label ?? s}: {fmtNum(n)}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {fmtNum(o.structure.units)} واحد سازمانی · {fmtNum(o.structure.roles)} نقش
                </p>
              </Card>

              <Card title="مدیران دانشگاه">
                {o.admins.length === 0 ? (
                  <p className="text-sm text-danger">هنوز مدیری معرفی نشده است.</p>
                ) : (
                  <ul className="flex flex-col gap-3 text-sm">
                    {o.admins.map((a, i) => (
                      <li key={i} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{a.fullName}</p>
                          {a.mobile && <p dir="ltr" className="text-end text-xs text-muted-foreground">{a.mobile}</p>}
                        </div>
                        <Badge tone={(MEMBERSHIP_STATUS as Labels)[a.status]?.tone ?? "neutral"}>{(MEMBERSHIP_STATUS as Labels)[a.status]?.label ?? a.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="فعالیت ۳۰ روز اخیر">
                <Rows
                  rows={[
                    ["اقدام ثبت‌شده در ممیزی", o.activity.actions30d],
                    ["پیامک ارسالی", o.activity.sms30d],
                    ["کاربر فعال", o.activity.activeUsers30d],
                  ]}
                />
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Module icon={FolderKanban} title="پرونده‌ها" total={o.cases.total} by={o.cases.byStatus} labels={CASE_STATUS as Labels} />
              <Module icon={GraduationCap} title="پایان‌نامه‌ها" total={o.theses.total} by={o.theses.byStatus} labels={THESIS_STATUS as Labels} />
              <Module icon={FileText} title="مقالات" total={o.papers.total} by={o.papers.byStatus} labels={PAPER_STATUS as Labels} />
              <Card>
                <Head icon={CalendarDays} title="رویدادها و اخبار" />
                <Rows
                  rows={[
                    ["رویداد اعلام‌شده", o.events.total],
                    ["رویداد پیش رو", o.events.upcoming],
                    ["ثبت‌نام", o.events.registrations],
                    ["خبر منتشرشده", o.news.published],
                    ["کانال خبری", o.news.channels],
                  ]}
                />
              </Card>
            </div>
          </section>
        );
      }}
    </QueryView>
  );
}

function Kpi({ icon: Icon, label, value, hint, bar }: { icon: LucideIcon; label: string; value: string; hint?: string; bar?: number | null }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="truncate text-xl font-black tabular-nums">{value}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        {bar !== undefined && bar !== null && (
          <div className="mt-2 h-1.5 rounded-full bg-muted" role="meter" aria-label="مصرف سهمیه" aria-valuenow={Math.round(bar)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${bar > 85 ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.max(1, bar)}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}

function Head({ icon: Icon, title, total }: { icon: LucideIcon; title: string; total?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon aria-hidden className="size-5 text-primary" />
      <h3 className="font-bold">{title}</h3>
      {total !== undefined && <span className="ms-auto text-lg font-black tabular-nums">{fmtNum(total)}</span>}
    </div>
  );
}

function Rows({ rows, empty }: { rows: [string, number][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty ?? "—"}</p>;
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-semibold tabular-nums">{fmtNum(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Module({ icon, title, total, by, labels }: { icon: LucideIcon; title: string; total: number; by: Record<string, number>; labels: Labels }) {
  return (
    <Card>
      <Head icon={icon} title={title} total={total} />
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">هنوز موردی ثبت نشده است.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(by).map(([s, n]) => (
            <Badge key={s} tone={labels[s]?.tone ?? "neutral"}>
              {labels[s]?.label ?? s}: {fmtNum(n)}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
