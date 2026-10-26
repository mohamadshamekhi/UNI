"use client";

import { clsx } from "clsx";
import { Bell, BellOff, CheckCheck, Inbox, MessageSquare, Smartphone, Mail } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { fmtDateTime, toFaDigits } from "../format";
import { Button } from "./button";
import { EmptyState, ErrorState, Loading } from "./states";

export interface NotificationItem {
  id: string;
  event: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

/** Bell, inbox and preferences talk through this event so each refreshes after the others change state. */
const CHANGED = "uni:notifications-changed";
const announce = () => window.dispatchEvent(new Event(CHANGED));

/** Unread counter polled every minute and refreshed on any local change (NTF-09). */
export function useUnreadCount(tenant: string) {
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    api<{ unread: number }>("/v1/me/notifications/unread-count", { tenant })
      .then((r) => setCount(r.unread))
      .catch(() => undefined);
  }, [tenant]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener(CHANGED, load);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(t);
      window.removeEventListener(CHANGED, load);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  return count;
}

const markRead = (tenant: string, id: string) => api(`/v1/me/notifications/${id}/read`, { method: "POST", tenant }).then(announce);
const markAll = (tenant: string) => api("/v1/me/notifications/read-all", { method: "POST", tenant }).then(announce);

/** Links stored for another app (e.g. a staff link seen in the portal) are not followed. */
export type LinkResolver = (link: string | null) => string | null;

function Row({ n, tenant, resolve, onNavigate, compact }: { n: NotificationItem; tenant: string; resolve: LinkResolver; onNavigate?: () => void; compact?: boolean }) {
  const href = resolve(n.link);
  const unread = !n.readAt;
  const content = (
    <>
      <span aria-hidden className={clsx("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} />
      <span className="min-w-0 flex-1">
        <span className={clsx("block text-sm", unread ? "font-bold" : "font-medium")}>
          {unread && <span className="sr-only">خوانده‌نشده: </span>}
          {n.title}
        </span>
        <span className={clsx("mt-0.5 block text-sm leading-6 text-muted-foreground", compact && "line-clamp-2")}>{n.body}</span>
        <span className="mt-1 block text-xs text-muted-foreground tabular">{fmtDateTime(n.createdAt)}</span>
      </span>
    </>
  );
  const cls = clsx("flex w-full gap-3 rounded-xl px-3 py-3 text-start transition-colors", unread && "bg-info-bg/50", href && "hover:bg-muted");
  const open = () => {
    if (unread) void markRead(tenant, n.id);
    onNavigate?.();
  };
  return href ? (
    <Link href={href} className={cls} onClick={open}>
      {content}
    </Link>
  ) : (
    <button type="button" className={clsx(cls, "cursor-pointer hover:bg-muted")} onClick={open}>
      {content}
    </button>
  );
}

/** Header bell with unread badge and a dropdown of the latest notifications. */
export function NotificationBell({ tenant, inboxHref, resolve, className }: { tenant: string; inboxHref: string; resolve: LinkResolver; className?: string }) {
  const unread = useUnreadCount(tenant);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api<{ items: NotificationItem[] }>("/v1/me/notifications", { tenant, query: { limit: 8 } })
      .then((r) => setItems(r.items))
      .catch(setError);
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, tenant, unread]);

  const label = unread ? `اعلان‌ها، ${toFaDigits(String(unread))} خوانده‌نشده` : "اعلان‌ها";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={clsx("relative flex size-10 cursor-pointer items-center justify-center rounded-full transition-colors", className)}
      >
        <Bell aria-hidden className="size-5" />
        {unread > 0 && (
          <span aria-hidden className="absolute -top-0.5 -end-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white ring-2 ring-background tabular">
            {unread > 99 ? "۹۹+" : toFaDigits(String(unread))}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="اعلان‌ها" className="absolute end-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card text-foreground shadow-[0_24px_60px_-20px_rgb(2_6_23/0.45)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-bold">اعلان‌ها</p>
            {unread > 0 && (
              <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => markAll(tenant)}>
                <CheckCheck aria-hidden className="size-4" />
                خواندن همه
              </button>
            )}
          </div>
          <div className="max-h-[26rem] overflow-y-auto p-2">
            {error ? (
              <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>
            ) : !items ? (
              <Loading rows={3} />
            ) : items.length === 0 ? (
              <p className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                <Inbox aria-hidden className="size-8" strokeWidth={1.5} />
                اعلانی ندارید.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {items.map((n) => (
                  <li key={n.id}>
                    <Row n={n} tenant={tenant} resolve={resolve} compact onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link href={inboxHref} onClick={() => setOpen(false)} className="block border-t border-border px-4 py-3 text-center text-sm font-medium text-primary hover:bg-muted">
            مشاهده همه اعلان‌ها
          </Link>
        </div>
      )}
    </div>
  );
}

const PAGE = 20;

/** Full inbox with an unread filter and paging. */
export function InboxList({ tenant, resolve }: { tenant: string; resolve: LinkResolver }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [data, setData] = useState<{ items: NotificationItem[]; total: number; unread: number } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    api<{ items: NotificationItem[]; total: number; unread: number }>("/v1/me/notifications", { tenant, query: { limit, unread: unreadOnly ? "true" : undefined } })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(setError);
  }, [tenant, limit, unreadOnly]);
  useEffect(() => {
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="فیلتر اعلان‌ها" className="inline-flex rounded-full bg-muted p-1 text-sm">
          {[
            [false, "همه"],
            [true, `خوانده‌نشده (${toFaDigits(String(data.unread))})`],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              role="tab"
              aria-selected={unreadOnly === v}
              onClick={() => setUnreadOnly(v as boolean)}
              className={clsx("cursor-pointer rounded-full px-4 py-1.5 transition-colors", unreadOnly === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {l as string}
            </button>
          ))}
        </div>
        {data.unread > 0 && (
          <Button variant="secondary" size="sm" onClick={() => markAll(tenant)}>
            <CheckCheck aria-hidden className="size-4" />
            علامت همه به‌عنوان خوانده‌شده
          </Button>
        )}
      </div>
      {data.items.length === 0 ? (
        <EmptyState icon={unreadOnly ? CheckCheck : Inbox} title={unreadOnly ? "اعلان خوانده‌نشده‌ای ندارید" : "هنوز اعلانی ندارید"} description="تغییرات پرونده‌ها و کارهای شما اینجا نمایش داده می‌شود." />
      ) : (
        <ul className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-2">
          {data.items.map((n) => (
            <li key={n.id}>
              <Row n={n} tenant={tenant} resolve={resolve} />
            </li>
          ))}
        </ul>
      )}
      {data.total > data.items.length && (
        <Button variant="secondary" className="self-center" onClick={() => setLimit((l) => l + PAGE)}>
          اعلان‌های قدیمی‌تر
        </Button>
      )}
    </div>
  );
}

const CHANNELS: { key: "inapp" | "sms" | "email"; label: string; icon: typeof Bell }[] = [
  { key: "inapp", label: "اعلان درون سامانه", icon: MessageSquare },
  { key: "sms", label: "پیامک", icon: Smartphone },
  { key: "email", label: "ایمیل", icon: Mail },
];

/** Channel switches for non-critical notifications (NTF-10). */
export function NotificationPreferences({ tenant }: { tenant: string }) {
  const [muted, setMuted] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ muted: string[] }>("/v1/me/notification-preferences", { tenant })
      .then((r) => setMuted(r.muted))
      .catch((e) => setError(errorMessage(e)));
  }, [tenant]);
  const toggle = async (ch: string, on: boolean) => {
    const next = on ? muted!.filter((x) => x !== ch) : [...muted!, ch];
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ muted: string[] }>("/v1/me/notification-preferences", { method: "PUT", tenant, body: { muted: next } });
      setMuted(r.muted);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  if (!muted) return error ? <p className="text-sm text-danger">{error}</p> : <Loading rows={3} />;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {CHANNELS.map(({ key, label, icon: Icon }) => {
          const on = !muted.includes(key);
          return (
            <li key={key} className="flex items-center justify-between gap-3 py-3">
              <span className="flex items-center gap-3 text-sm">
                <span className="flex size-9 items-center justify-center rounded-xl bg-info-bg text-primary">
                  {on ? <Icon aria-hidden className="size-4" /> : <BellOff aria-hidden className="size-4" />}
                </span>
                {label}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                disabled={saving}
                onClick={() => toggle(key, !on)}
                className={clsx("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-60", on ? "bg-primary" : "bg-border")}
              >
                <span aria-hidden className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start]", on ? "start-[1.375rem]" : "start-0.5")} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-6 text-muted-foreground">کد ورود، دعوت‌ها، پایان مهلت و ارجاع‌های پس از تأخیر همیشه ارسال می‌شوند و با این تنظیم خاموش نمی‌شوند.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
