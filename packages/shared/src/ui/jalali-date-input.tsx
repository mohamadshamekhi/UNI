"use client";

import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { toFaDigits } from "../format";
import { JALALI_MONTHS, WEEKDAYS, isoDate, jalaliMonthLength, parseIsoDate, toGregorian, toJalali } from "../jalali";

/**
 * Jalali date field (UX-02): shows and picks Persian calendar dates, stores ISO Gregorian
 * "YYYY-MM-DD". Grid supports arrow keys, Home/End, PageUp/PageDown and Esc.
 */
export function JalaliDateInput({
  value,
  onChange,
  id,
  min,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  /** earliest selectable ISO date */
  min?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const parsed = parseIsoDate(value);
  const selected = parsed ? toJalali(parsed.gy, parsed.gm, parsed.gd) : null;
  const today = new Date();
  const todayJ = toJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({ jy: selected?.jy ?? todayJ.jy, jm: selected?.jm ?? todayJ.jm }));
  const [focusDay, setFocusDay] = useState(selected?.jd ?? todayJ.jd);
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay, view]);

  const minIso = min ?? "";
  const len = jalaliMonthLength(view.jy, view.jm);
  const first = toGregorian(view.jy, view.jm, 1);
  // JS getDay: 0=Sun … 6=Sat; Persian week starts Saturday
  const offset = (new Date(first.gy, first.gm - 1, first.gd).getDay() + 1) % 7;
  const isoOf = (jd: number) => {
    const g = toGregorian(view.jy, view.jm, jd);
    return isoDate(g.gy, g.gm, g.gd);
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const idx = v.jy * 12 + (v.jm - 1) + delta;
      return { jy: Math.floor(idx / 12), jm: (idx % 12) + 1 };
    });
  };

  const onGridKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 }; // RTL
    if (e.key in moves) {
      e.preventDefault();
      const next = focusDay + moves[e.key]!;
      if (next < 1) {
        shiftMonth(-1);
        setFocusDay(28 + next);
      } else if (next > len) {
        shiftMonth(1);
        setFocusDay(next - len);
      } else setFocusDay(next);
    } else if (e.key === "Home") setFocusDay(1);
    else if (e.key === "End") setFocusDay(len);
    else if (e.key === "PageUp") shiftMonth(-1);
    else if (e.key === "PageDown") shiftMonth(1);
    else if (e.key === "Escape") setOpen(false);
  };

  const label = selected ? `${toFaDigits(String(selected.jd))} ${JALALI_MONTHS[selected.jm - 1]} ${toFaDigits(String(selected.jy))}` : "انتخاب تاریخ";

  return (
    <div ref={wrap} className="relative">
      <div className="flex gap-2">
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onClick={() => setOpen((o) => !o)}
          className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-start text-sm aria-[invalid=true]:border-danger"
        >
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
          <span className={selected ? "" : "text-muted-foreground"}>{label}</span>
        </button>
        {value && (
          <button type="button" aria-label="پاک کردن تاریخ" onClick={() => onChange("")} className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-muted">
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div role="dialog" aria-modal="false" aria-labelledby={labelId} className="absolute start-0 z-50 mt-1 w-72 rounded-lg border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="ماه قبل" onClick={() => shiftMonth(-1)} className="flex size-8 cursor-pointer items-center justify-center rounded hover:bg-muted">
              <ChevronRight aria-hidden className="size-4" />
            </button>
            <p id={labelId} className="text-sm font-semibold" aria-live="polite">
              {JALALI_MONTHS[view.jm - 1]} {toFaDigits(String(view.jy))}
            </p>
            <button type="button" aria-label="ماه بعد" onClick={() => shiftMonth(1)} className="flex size-8 cursor-pointer items-center justify-center rounded hover:bg-muted">
              <ChevronLeft aria-hidden className="size-4" />
            </button>
          </div>
          <div role="grid" ref={grid} onKeyDown={onGridKey} className="grid grid-cols-7 gap-1 text-center text-sm">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader" className="py-1 text-xs text-muted-foreground">
                {d}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: len }, (_, i) => {
              const jd = i + 1;
              const iso = isoOf(jd);
              const isSel = !!selected && selected.jy === view.jy && selected.jm === view.jm && selected.jd === jd;
              const isToday = todayJ.jy === view.jy && todayJ.jm === view.jm && todayJ.jd === jd;
              const disabled = !!minIso && iso < minIso;
              return (
                <button
                  key={jd}
                  type="button"
                  role="gridcell"
                  data-day={jd}
                  tabIndex={jd === focusDay ? 0 : -1}
                  disabled={disabled}
                  aria-selected={isSel}
                  aria-label={`${toFaDigits(String(jd))} ${JALALI_MONTHS[view.jm - 1]} ${toFaDigits(String(view.jy))}`}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={`h-8 cursor-pointer rounded tabular disabled:cursor-not-allowed disabled:opacity-30 ${
                    isSel ? "bg-primary text-on-primary" : isToday ? "border border-primary text-primary" : "hover:bg-muted"
                  }`}
                >
                  {toFaDigits(String(jd))}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
