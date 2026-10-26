"use client";

import { Logo } from "@uni/shared/ui/logo";
import { ThemeToggle } from "@uni/shared/ui/theme";
import { clsx } from "clsx";
import { ChevronDown, ChevronsUpDown, KeyRound, LayoutGrid, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMe } from "@/lib/hooks";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** section heading shown above the first item of each group */
  group?: string;
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign("/login");
}

const initials = (name?: string) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("‌");

/**
 * Backoffice frame: deep-navy sidebar (same visual language as the public site), sticky top bar
 * with page context, theme toggle and user menu. Sidebar becomes a drawer below lg.
 */
export function AppShell({ title, subtitle, nav, actions, children }: { title: string; subtitle?: string; nav: NavItem[]; actions?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
  const current = [...nav].reverse().find(isActive);

  const sidebar = (
    <div className="hero-band relative isolate flex h-full flex-col overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10">
        <span className="aurora aurora-1 -top-24 -end-24 size-72 opacity-40" />
        <span className="aurora aurora-3 -bottom-28 -start-20 size-64 opacity-25" />
        <div className="grid-lines absolute inset-0 opacity-60" />
      </div>
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <Logo className="size-9" />
        <div className="leading-tight">
          <p className="font-bold">پنل مدیریت</p>
          <p className="text-xs text-white/60">سامانه خدمات دانشگاهی</p>
        </div>
      </div>

      <Link href="/" className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 transition-colors hover:bg-white/[0.12]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <LayoutGrid aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {subtitle && <span className="block truncate text-xs text-white/60">{subtitle}</span>}
        </span>
        <ChevronsUpDown aria-hidden className="size-4 text-white/50" />
        <span className="sr-only">تغییر محیط کار</span>
      </Link>

      <nav aria-label="منوی اصلی" className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="flex flex-col gap-0.5">
          {nav.map((item, i) => {
            const active = isActive(item);
            const showGroup = item.group && item.group !== nav[i - 1]?.group;
            return (
              <li key={item.href}>
                {showGroup && <p className="mt-4 mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-white/45">{item.group}</p>}
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150",
                    active ? "bg-white/[0.13] font-semibold text-white" : "text-white/70 hover:bg-white/[0.07] hover:text-white",
                  )}
                >
                  {active && <span aria-hidden className="absolute inset-y-2 start-0 w-1 rounded-full bg-gold-bright" />}
                  <item.icon aria-hidden className={clsx("size-[18px] shrink-0", active ? "text-gold-bright" : "")} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="px-5 pb-4 text-[11px] text-white/40">نسخه ۱ · فاز یک</p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="بستن منو" className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 shadow-2xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl lg:px-8">
          <button type="button" aria-label={open ? "بستن منو" : "باز کردن منو"} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex size-10 cursor-pointer items-center justify-center rounded-lg hover:bg-muted lg:hidden">
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
          <nav aria-label="مسیر" className="min-w-0 flex-1">
            <ol className="flex items-center gap-2 text-sm">
              <li className="hidden truncate text-muted-foreground sm:block">{title}</li>
              {current && (
                <>
                  <li aria-hidden className="hidden text-muted-foreground/50 sm:block">/</li>
                  <li className="truncate font-semibold" aria-current="page">{current.label}</li>
                </>
              )}
            </ol>
          </nav>
          {actions}
          <ThemeToggle className="hover:bg-muted" />
          <UserMenu />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Account menu: keyboard operable (Esc closes, focus moves into the menu), closes on outside click. */
function UserMenu() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-muted focus:bg-muted focus:outline-none";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card py-1 ps-1 pe-3 shadow-sm transition-colors hover:bg-muted"
      >
        <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2f6bff] to-[#1e3a8a] text-xs font-bold text-white">
          {initials(me.data?.fullName) || "…"}
        </span>
        <span className="hidden max-w-36 truncate text-sm font-medium sm:block">{me.data?.fullName ?? "…"}</span>
        <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div role="menu" aria-label="حساب کاربری" className="absolute end-0 mt-2 w-64 rounded-2xl border border-border bg-card p-2 shadow-[0_24px_60px_-20px_rgb(2_6_23/0.45)]">
          <div className="border-b border-border px-3 pt-1.5 pb-3">
            <p className="truncate font-semibold">{me.data?.fullName}</p>
            <p className="truncate text-xs text-muted-foreground tabular" dir="ltr">
              {me.data?.mobile}
            </p>
            {me.data?.isPlatformAdmin && <p className="mt-1.5 inline-block rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">مدیر کل سامانه</p>}
          </div>
          <div className="pt-2">
            <Link role="menuitem" href="/" className={item} onClick={() => setOpen(false)}>
              <LayoutGrid aria-hidden className="size-4 text-muted-foreground" />
              انتخاب محیط کار
            </Link>
            <Link role="menuitem" href="/account" className={item} onClick={() => setOpen(false)}>
              <KeyRound aria-hidden className="size-4 text-muted-foreground" />
              امنیت حساب
            </Link>
            <button role="menuitem" type="button" onClick={logout} className={clsx(item, "text-danger hover:bg-danger-bg focus:bg-danger-bg")}>
              <LogOut aria-hidden className="size-4" />
              خروج
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
