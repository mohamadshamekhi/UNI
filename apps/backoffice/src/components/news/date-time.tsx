"use client";

import { JalaliDateInput } from "@uni/shared/ui/jalali-date-input";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local ISO → { date: YYYY-MM-DD, time: HH:mm } in the browser's zone. */
function split(iso: string | null) {
  if (!iso) return { date: "", time: "09:00" };
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Jalali date plus time; emits a full ISO timestamp (or null when cleared). */
export function DateTimeInput({ id, value, onChange }: { id: string; value: string | null; onChange: (iso: string | null) => void }) {
  const { date, time } = split(value);
  const emit = (d: string, t: string) => onChange(d ? new Date(`${d}T${t || "00:00"}:00`).toISOString() : null);
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <JalaliDateInput id={id} value={date} onChange={(d) => emit(d, time)} />
      </div>
      <input
        type="time"
        aria-label="ساعت"
        dir="ltr"
        value={time}
        onChange={(e) => emit(date, e.target.value)}
        className="h-10 w-28 rounded-xl border border-border bg-card px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}
