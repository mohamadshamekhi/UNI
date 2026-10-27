"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FolderOpen, UserPlus, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtNum, fmtRial } from "@uni/shared/format";
import { Button } from "@uni/shared/ui/button";
import { Field, Select } from "@uni/shared/ui/field";
import { JalaliDateInput } from "@uni/shared/ui/jalali-date-input";
import { Card, PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { ReportTable } from "@uni/shared/types";
import { useCan, useSlug, useUnits } from "@/lib/hooks";

interface Summary {
  openCases: number;
  overdueCases: number;
  closedLast30Days: number;
  pendingMemberships: number | null;
  paidLast30Days: number | null;
  paymentsInReview: number | null;
}

/** Which numeric column each report draws as bars (the table below always shows everything). */
const CHART: Record<string, { value: string; label: (r: Record<string, unknown>) => string } | undefined> = {
  cases_by_status: { value: "count", label: (r) => `${r.requestType} — ${r.status}` },
  step_durations: { value: "meanHours", label: (r) => `${r.requestType} — ${r.step}` },
  open_tasks: { value: "count", label: (r) => `${r.step} — ${r.assignee}` },
  memberships: { value: "count", label: (r) => `${r.kind} — ${r.status}` },
  papers: { value: "count", label: (r) => `${r.degree} — ${r.status}` },
  news: { value: "views", label: (r) => String(r.title) },
  events: { value: "total", label: (r) => String(r.title) },
  finance: { value: "total", label: (r) => `${r.title} — ${r.status}` },
};
const FINANCE_ONLY = new Set(["finance"]);

/** Management dashboard (section 15): headline numbers, one report at a time, exports (AUD-09). */
export default function ReportsPage() {
  const slug = useSlug();
  const can = useCan(slug);
  const toast = useToast();
  const { flat } = useUnits(slug);
  const reports = useQuery({ queryKey: ["reports", slug], queryFn: () => api<{ key: string; title: string }[]>("/v1/admin/reports", { tenant: slug }) });
  const summary = useQuery({ queryKey: ["reports-summary", slug], queryFn: () => api<Summary>("/v1/admin/reports/summary", { tenant: slug }) });
  const [key, setKey] = useState("cases_by_status");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [busy, setBusy] = useState<"csv" | "xlsx" | null>(null);
  const filter = { from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, unitId: unitId || undefined };
  const table = useQuery({
    queryKey: ["report", slug, key, filter],
    queryFn: () => api<ReportTable>(`/v1/admin/reports/${key}`, { tenant: slug, query: filter }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const visible = (reports.data ?? []).filter((r) => !FINANCE_ONLY.has(r.key) || can("payment.view"));

  const exportAs = async (format: "csv" | "xlsx") => {
    setBusy(format);
    try {
      const qs = new URLSearchParams(Object.entries({ ...filter, format }).filter((e): e is [string, string] => !!e[1]));
      const res = await fetch(`/api/proxy/v1/admin/reports/${key}/export?${qs}`, { headers: { "x-tenant": slug } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "دریافت فایل ممکن نشد.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${key}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const s = summary.data;
  return (
    <>
      <PageHeader eyebrow="گزارش‌ها" title="داشبورد مدیریتی" description="همه اعداد به دانشگاه و واحدهایی محدودند که مجوز گزارش آن‌ها را دارید." />
      {s && (
        <ul className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={FolderOpen} label="پرونده‌های باز" value={fmtNum(s.openCases)} />
          <Kpi icon={AlertTriangle} label="پرونده‌های دارای تأخیر" value={fmtNum(s.overdueCases)} tone={s.overdueCases ? "danger" : undefined} />
          <Kpi icon={CheckCircle2} label="بسته‌شده در ۳۰ روز" value={fmtNum(s.closedLast30Days)} />
          {s.paidLast30Days !== null ? (
            <Kpi icon={Wallet} label="دریافتی ۳۰ روز" value={fmtRial(s.paidLast30Days)} hint={s.paymentsInReview ? `${fmtNum(s.paymentsInReview)} پرداخت در انتظار بررسی` : undefined} />
          ) : s.pendingMemberships !== null ? (
            <Kpi icon={UserPlus} label="عضویت‌های در انتظار" value={fmtNum(s.pendingMemberships)} />
          ) : null}
        </ul>
      )}

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1.5fr] xl:items-end">
          <Field label="گزارش">
            {(p) => (
              <Select {...p} value={key} onChange={(e) => setKey(e.target.value)}>
                {visible.map((r) => (
                  <option key={r.key} value={r.key}>{r.title}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="از تاریخ">{(p) => <JalaliDateInput id={p.id} value={from} onChange={setFrom} />}</Field>
          <Field label="تا تاریخ">{(p) => <JalaliDateInput id={p.id} value={to} onChange={setTo} />}</Field>
          <Field label="واحد">
            {(p) => (
              <Select {...p} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">همه واحدهای مجاز</option>
                {flat.map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <section aria-labelledby="rep" className="mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="rep" className="text-lg font-bold">{table.data?.title ?? visible.find((r) => r.key === key)?.title}</h2>
          {can("report.export") && (
            <div className="ms-auto flex gap-2">
              <Button size="sm" variant="secondary" loading={busy === "xlsx"} onClick={() => void exportAs("xlsx")}>
                <Download aria-hidden className="size-4" />
                اکسل
              </Button>
              <Button size="sm" variant="secondary" loading={busy === "csv"} onClick={() => void exportAs("csv")}>
                <Download aria-hidden className="size-4" />
                CSV
              </Button>
            </div>
          )}
        </div>
        <QueryView query={table} isEmpty={(d) => d.rows.length === 0} empty={<EmptyState title="داده‌ای برای این بازه نیست" />}>
          {(t) => (
            <>
              {CHART[key] && <Bars table={t} spec={CHART[key]!} money={key === "finance"} />}
              <Table caption={t.title}>
                <thead>
                  <tr>
                    {t.columns.map((c) => (
                      <Th key={c.key} className={c.type === "number" ? "text-end" : undefined}>{c.label}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r, i) => (
                    <tr key={i}>
                      {t.columns.map((c) => (
                        <Td key={c.key} className={c.type === "number" ? "text-end tabular-nums" : undefined}>
                          {cell(r[c.key], c.type)}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </QueryView>
      </section>
    </>
  );
}

function cell(v: unknown, type?: string): ReactNode {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "number") return fmtNum(Number(v));
  if (type === "date") return fmtDateTime(String(v));
  return String(v);
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Wallet; label: string; value: string; hint?: string; tone?: "danger" }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone === "danger" ? "bg-danger-bg text-danger" : "bg-primary/10 text-primary"}`}>
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-black tabular-nums">{value}</p>
        {hint && <p className="text-xs text-warning">{hint}</p>}
      </div>
    </li>
  );
}

/** Horizontal bars, sorted, with the value written next to each (no meaning carried by colour alone). */
function Bars({ table, spec, money }: { table: ReportTable; spec: { value: string; label: (r: Record<string, unknown>) => string }; money: boolean }) {
  const items = table.rows
    .map((r) => ({ label: spec.label(r), value: Number(r[spec.value] ?? 0) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  if (!items.length) return null;
  const max = Math.max(...items.map((x) => x.value));
  const col = table.columns.find((c) => c.key === spec.value)?.label ?? "";
  return (
    <figure className="rounded-2xl border border-border bg-card p-5">
      <figcaption className="mb-3 text-sm text-muted-foreground">{col} — {items.length === table.rows.length ? "همه ردیف‌ها" : `${fmtNum(items.length)} مورد برتر`}</figcaption>
      <ul className="flex flex-col gap-2">
        {items.map((x) => (
          <li key={x.label} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate" title={x.label}>{x.label}</span>
            <span className="h-3 rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (x.value / max) * 100)}%` }} />
            </span>
            <span className="tabular-nums font-semibold">{money ? fmtRial(x.value) : fmtNum(x.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
