"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Landmark, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDate } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Checkbox, Field, Input } from "@uni/shared/ui/field";
import { JalaliDateInput } from "@uni/shared/ui/jalali-date-input";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { useSlug } from "@/lib/hooks";

interface Holiday {
  id: string;
  day: string;
  title: string;
  national: boolean;
}

// Saturday-first, as on Iranian calendars; values are JS weekday numbers (0 = Sunday)
const WEEK = [
  [6, "شنبه"],
  [0, "یکشنبه"],
  [1, "دوشنبه"],
  [2, "سه‌شنبه"],
  [3, "چهارشنبه"],
  [4, "پنجشنبه"],
  [5, "جمعه"],
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Working calendar (WF-20): weekly days off and holidays used for business-day deadlines. */
export default function CalendarPage() {
  const slug = useSlug();
  const tenant = useQuery({ queryKey: ["tenant-admin", slug], queryFn: () => api<{ settings: { weekendDays?: number[] } }>("/v1/admin/tenant", { tenant: slug }) });
  const from = iso(new Date(Date.now() - 30 * 86_400_000));
  const to = iso(new Date(Date.now() + 400 * 86_400_000));
  const holidays = useQuery({ queryKey: ["holidays", slug, from], queryFn: () => api<Holiday[]>("/v1/admin/holidays", { tenant: slug, query: { from, to } }) });

  return (
    <>
      <PageHeader eyebrow="سامانه" title="تقویم کاری" description="مهلت مراحل با روز کاری حساب می‌شود؛ روزهای تعطیل هفته و تعطیلات رسمی و دانشگاه از آن کم می‌شوند." />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-4">
          <Card title="روزهای تعطیل هفته">
            <QueryView query={tenant}>{(t) => <Weekend initial={t.settings.weekendDays ?? [5]} />}</QueryView>
          </Card>
          <Card title="افزودن تعطیلی دانشگاه">
            <AddHoliday />
          </Card>
        </div>
        <Card title="تعطیلات پیش رو">
          <QueryView query={holidays} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={CalendarDays} title="تعطیلی ثبت نشده" description="تعطیلات رسمی را مدیر کل سامانه و تعطیلات دانشگاه را شما اضافه می‌کنید." />}>
            {(rows) => <HolidayList rows={rows} />}
          </QueryView>
        </Card>
      </div>
    </>
  );
}

function Weekend({ initial }: { initial: number[] }) {
  const slug = useSlug();
  const toast = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState<number[]>(initial);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try {
      await api("/v1/admin/tenant/settings", { method: "PATCH", tenant: slug, body: { weekendDays: days } });
      qc.invalidateQueries({ queryKey: ["tenant-admin", slug] });
      toast("روزهای تعطیل هفته ذخیره شد.");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {WEEK.map(([n, label]) => (
          <Checkbox
            key={n}
            label={label}
            checked={days.includes(n)}
            disabled={!days.includes(n) && days.length >= 3}
            onChange={(e) => setDays(e.target.checked ? [...days, n] : days.filter((d) => d !== n))}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">حداکثر سه روز. پیش‌فرض: جمعه.</p>
      <Button variant="secondary" loading={pending} onClick={save} className="self-start">ذخیره</Button>
    </div>
  );
}

function AddHoliday() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [day, setDay] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!day) return setError("تاریخ را انتخاب کنید.");
    if (!title.trim()) return setError("عنوان را بنویسید.");
    setPending(true);
    setError(null);
    try {
      await api("/v1/admin/holidays", { method: "POST", tenant: slug, body: { day: day.slice(0, 10), title: title.trim() } });
      qc.invalidateQueries({ queryKey: ["holidays", slug] });
      setDay("");
      setTitle("");
      toast("تعطیلی اضافه شد؛ مهلت‌های جدید آن را در نظر می‌گیرند.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="تاریخ" required>
        {(p) => <JalaliDateInput {...p} value={day} onChange={setDay} />}
      </Field>
      <Field label="عنوان" required hint="مثلاً «تعطیلی بین دو ترم».">
        {(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" loading={pending} className="self-start">
        <Plus aria-hidden className="size-4" />
        افزودن
      </Button>
    </form>
  );
}

function HolidayList({ rows }: { rows: Holiday[] }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const remove = async (h: Holiday) => {
    try {
      await api(`/v1/admin/holidays/${h.id}`, { method: "DELETE", tenant: slug });
      qc.invalidateQueries({ queryKey: ["holidays", slug] });
      toast("تعطیلی حذف شد.");
    } catch (e) {
      toast(errorMessage(e));
    }
  };
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((h) => (
        <li key={h.id} className="flex items-center gap-3 py-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${h.national ? "bg-warning-bg text-warning" : "bg-info-bg text-primary"}`}>
            {h.national ? <Landmark aria-hidden className="size-5" /> : <CalendarDays aria-hidden className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{h.title}</p>
            <p className="text-xs text-muted-foreground tabular">{fmtDate(`${h.day}T12:00:00Z`)}</p>
          </div>
          {h.national ? (
            <Badge tone="warning">رسمی</Badge>
          ) : (
            <Button size="sm" variant="ghost" className="text-danger" aria-label={`حذف ${h.title}`} onClick={() => remove(h)}>
              <Trash2 aria-hidden className="size-4" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
