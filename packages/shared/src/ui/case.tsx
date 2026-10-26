import { clsx } from "clsx";
import { AlarmClock, CircleCheck, CircleDot, CornerUpLeft, Flag, Send, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { fmtDate, fmtDateTime } from "../format";
import { CASE_STATUS, type Tone } from "../labels";
import type { CaseStatusCategory } from "../types";
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
