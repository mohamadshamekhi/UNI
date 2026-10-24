"use client";

import { clsx } from "clsx";
import { LogOut, Menu, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useMe } from "@/lib/hooks";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign("/login");
}

/** Sidebar on the start (right in RTL) edge; collapses into a drawer below lg. */
export function AppShell({ title, subtitle, nav, children }: { title: string; subtitle?: string; nav: NavItem[]; children: ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  const sidebar = (
    <nav aria-label="منوی اصلی" className="flex h-full flex-col gap-1 p-3">
      <Link href="/" className="mb-3 block rounded-md px-2 py-2 hover:bg-muted">
        <span className="block text-sm font-bold">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
      </Link>
      <ul className="flex flex-col gap-0.5">
        {nav.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150",
                  active ? "bg-primary text-on-primary" : "text-foreground hover:bg-muted",
                )}
              >
                <item.icon aria-hidden className="size-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto border-t border-border pt-3">
        <p className="truncate px-2 text-sm font-medium">{me.data?.fullName ?? "…"}</p>
        <p className="truncate px-2 text-xs text-muted-foreground tabular" dir="ltr">
          {me.data?.mobile}
        </p>
        <button type="button" onClick={logout} className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-danger hover:bg-danger-bg">
          <LogOut aria-hidden className="size-4" />
          خروج
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-e border-border bg-card lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="بستن منو" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-card shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-card px-3 lg:hidden">
          <button type="button" aria-label={open ? "بستن منو" : "باز کردن منو"} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="cursor-pointer rounded p-2 hover:bg-muted">
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
          <span className="truncate text-sm font-semibold">{title}</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
