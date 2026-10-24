import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { Tone } from "../labels";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-bg text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

/** Status is always written out in text; colour is only a secondary cue. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}
