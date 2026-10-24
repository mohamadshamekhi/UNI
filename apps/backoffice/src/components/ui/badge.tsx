import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-bg text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

/** Status is always written out in text; colour is only a secondary cue. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}
