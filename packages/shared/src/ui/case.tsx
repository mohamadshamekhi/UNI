"use client";

import { clsx } from "clsx";
import { AlarmClock, CircleCheck, CircleDot, CornerUpLeft, FileText, Flag, Lock, Send, XCircle, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { errorMessage } from "../api";
import { fmtBytes, fmtDate, fmtDateTime } from "../format";
import { CASE_STATUS, type Tone } from "../labels";
import type { CaseAttachment, CaseStatusCategory } from "../types";
import { openFile } from "./form-fields";
import { Badge } from "./badge";

export const CaseStatusBadge = ({ status }: { status: CaseStatusCategory }) => <Badge tone={CASE_STATUS[status].tone}>{CASE_STATUS[status].label}</Badge>;

/** Due date with an overdue / due-soon cue in text, not colour alone. */
export function DueBadge({ dueAt, overdue }: { dueAt: string | null; overdue?: boolean }) {
  if (!dueAt) return <span className="text-muted-foreground">—</span>;
  const ms = new Date(dueAt).getTime() - Date.now();
  const late = overdue || ms < 0;
  const soon = !late && ms < 2 * 86_400_000;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 tabular">
      {fmtDate(dueAt)}
      {late && <Badge tone="danger">گذشته از مهلت</Badge>}
      {soon && <Badge tone="warning">نزدیک مهلت</Badge>}
    </span>
  );
}

/** Short reference shown to people instead of the UUID. */
export const caseRef = (id: string) => id.slice(0, 8).toUpperCase();

export interface TimelineItem {
  key: string;
  title: string;
  at: string;
  tone?: Tone;
  meta?: string | null;
  children?: ReactNode;
}

const ICON: Record<Tone, LucideIcon> = { neutral: CircleDot, info: Send, success: CircleCheck, warning: CornerUpLeft, danger: XCircle };
const DOT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-bg text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

/** Vertical history list; newest last, like the case actually unfolded. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative flex flex-col gap-5">
      <span aria-hidden className="absolute start-[15px] top-2 bottom-2 w-px bg-border" />
      {items.map((it) => {
        const tone = it.tone ?? "neutral";
        const Icon = ICON[tone];
        return (
          <li key={it.key} className="relative flex gap-3">
            <span aria-hidden className={clsx("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", DOT[tone])}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm font-semibold">{it.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular">
                {fmtDateTime(it.at)}
                {it.meta && <> · {it.meta}</>}
              </p>
              {it.children && <div className="mt-2 flex flex-col gap-1.5 text-sm">{it.children}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Tone of a history entry, from its type and the action taken. */
export function eventTone(type: string, action?: string | null): Tone {
  if (type === "closed") return action === "success" ? "success" : action === "failure" ? "danger" : "neutral";
  if (type === "returned" || type === "extended") return "warning";
  if (type === "overdue" || type === "escalated" || type === "expired" || type === "withdrawn") return "danger";
  if (type === "action") return action === "reject" ? "danger" : action === "return_for_fix" ? "warning" : "success";
  if (type === "created" || type === "resubmitted") return "info";
  return "neutral";
}

/** Steps the case is waiting on right now, as a highlighted strip. */
export function CurrentSteps({ steps, status }: { steps: { stepId: string; title: string }[]; status: CaseStatusCategory }) {
  const closed = status === "success" || status === "failure" || status === "cancelled";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {closed ? (
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <Flag aria-hidden className="size-4 text-gold" />
          رسیدگی به پایان رسیده است
        </span>
      ) : (
        steps.map((s) => (
          <span key={s.stepId} className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-info-bg px-3 py-1 text-sm font-medium text-primary">
            <AlarmClock aria-hidden className="size-4" />
            {s.title}
          </span>
        ))
      )}
    </div>
  );
}

/** Case attachments with their form field; each open issues a fresh single-use link. */
export function AttachmentList({ tenant, items, labels, internalKeys }: { tenant: string; items: CaseAttachment[]; labels: Record<string, string>; internalKeys?: Set<string> }) {
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return <p className="text-sm text-muted-foreground">پیوستی ندارد.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {items.map((f) => {
          const ready = f.scanStatus === "clean" || f.scanStatus === "skipped";
          return (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <FileText aria-hidden className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" dir="auto">{f.originalName}</p>
                <p className="text-xs text-muted-foreground">
                  {f.field ? (labels[f.field] ?? f.field) : "پیوست"} · <span className="tabular">{fmtBytes(f.sizeBytes)}</span>
                  {internalKeys?.has(f.field ?? "") && (
                    <span className="ms-1 inline-flex items-center gap-0.5">
                      · <Lock aria-hidden className="size-3" /> داخلی
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={!ready}
                onClick={() => openFile(tenant, f.id).catch((e) => setError(errorMessage(e)))}
                className="min-h-9 cursor-pointer rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted disabled:cursor-default disabled:text-muted-foreground"
              >
                {ready ? "مشاهده" : "در حال بررسی امنیتی"}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * THS-06: the definition's main path as a stepper — done, current (the case waits here) and
 * upcoming. A finished case shows every step done (success) or stops where it ended.
 */
export function CaseStepper({ path, current, status }: { path: { stepId: string; title: string }[]; current: string[]; status: CaseStatusCategory }) {
  const firstCurrent = path.findIndex((s) => current.includes(s.stepId));
  const done = (i: number) => status === "success" || (firstCurrent >= 0 ? i < firstCurrent : false);
  return (
    <ol aria-label="مراحل پرونده" className="flex gap-1 overflow-x-auto pb-2">
      {path.map((s, i) => {
        const isCurrent = current.includes(s.stepId) && status !== "success";
        const isDone = done(i);
        return (
          <li key={s.stepId} aria-current={isCurrent ? "step" : undefined} className="flex min-w-28 flex-1 flex-col items-center gap-2 text-center">
            <div className="flex w-full items-center">
              <span className={clsx("h-0.5 flex-1", i === 0 ? "bg-transparent" : isDone || isCurrent ? "bg-primary" : "bg-border")} />
              <span
                className={clsx(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular",
                  isDone ? "bg-primary text-on-primary" : isCurrent ? "bg-gold text-white ring-4 ring-gold/25" : "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <CircleCheck aria-hidden className="size-4" /> : String(i + 1).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!)}
              </span>
              <span className={clsx("h-0.5 flex-1", i === path.length - 1 ? "bg-transparent" : isDone ? "bg-primary" : "bg-border")} />
            </div>
            <span className={clsx("text-xs leading-5", isCurrent ? "font-bold text-foreground" : isDone ? "text-foreground" : "text-muted-foreground")}>
              {s.title}
              {isCurrent && <span className="sr-only"> (مرحله فعلی)</span>}
              {isDone && <span className="sr-only"> (انجام شد)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
