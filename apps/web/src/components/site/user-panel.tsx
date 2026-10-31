"use client";

import { Bell, CalendarCheck, ChevronDown, FileText, FolderOpen, GraduationCap, LayoutDashboard, LogOut, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/** Personal pages of a signed-in member, in panel order. */
export const PANEL_LINKS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "me", label: "وضعیت من", icon: LayoutDashboard },
  { path: "cases", label: "پرونده‌های من", icon: FolderOpen },
  { path: "thesis", label: "پرونده تحصیلی", icon: GraduationCap },
  { path: "papers", label: "مقالات من", icon: FileText },
  { path: "events/mine", label: "ثبت‌نام رویدادها", icon: CalendarCheck },
  { path: "payments", label: "پرداخت‌ها", icon: Wallet },
  { path: "notifications", label: "اعلان‌ها", icon: Bell },
];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export const logout = async (slug: string) => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign(`/${slug}`);
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("‌");

/** Header account button: avatar + first name, opening the member's panel links (WAI menu-button). */
export function AccountMenu({ slug, fullName, solid }: { slug: string; fullName: string; solid: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();

  // close on navigation (render-time reset, no effect)
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-10 cursor-pointer items-center gap-2 rounded-full ps-1 pe-2.5 text-sm font-medium transition-colors ${solid ? "hover:bg-muted" : "hover:bg-white/10"}`}
      >
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#2f6bff] to-[#0b1f52] text-xs font-bold text-white">
          {initials(fullName)}
        </span>
        <span className="max-w-28 truncate">{fullName.split(" ")[0]}</span>
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} role="menu" aria-label="حساب کاربری" onKeyDown={onMenuKey} className="absolute end-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-border bg-card p-1.5 text-foreground shadow-[0_24px_48px_-20px_rgb(15_23_42/0.45)]">
          <p className="truncate px-3 pt-2 pb-2.5 text-sm font-bold">{fullName}</p>
          <div className="border-t border-border pt-1.5">
            {PANEL_LINKS.map((l) => (
              <Link
                key={l.path}
                role="menuitem"
                href={`/${slug}/${l.path}`}
                className="flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-sm outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <l.icon aria-hidden className="size-4 text-muted-foreground" />
                {l.label}
              </Link>
            ))}
          </div>
          <div className="mt-1.5 border-t border-border pt-1.5">
            <button type="button" role="menuitem" onClick={() => void logout(slug)} className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm text-danger outline-none hover:bg-danger-bg focus-visible:bg-danger-bg">
              <LogOut aria-hidden className="size-4" />
              خروج
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Member panel navigation: a sidebar on large screens, a scrollable tab strip on small ones. */
export function PanelNav({ slug, fullName }: { slug: string; fullName?: string }) {
  const pathname = usePathname();
  const strip = useRef<HTMLElement>(null);
  // keep the current tab in view on small screens
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  return (
    <>
      <nav aria-label="پنل کاربری" className="sticky top-24 hidden h-fit flex-col gap-1 rounded-3xl border border-border bg-card p-3 lg:flex">
        {fullName && <p className="truncate px-3 pt-1 pb-3 text-sm font-bold">{fullName}</p>}
        {PANEL_LINKS.map((l) => {
          const href = `/${slug}/${l.path}`;
          const active = isActive(pathname, href);
          return (
            <Link
              key={l.path}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm transition-colors ${active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <l.icon aria-hidden className="size-[18px]" />
              {l.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => void logout(slug)} className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-t border-border px-3 pt-1 text-sm text-danger hover:bg-danger-bg">
          <LogOut aria-hidden className="size-[18px]" />
          خروج
        </button>
      </nav>
      <nav ref={strip} aria-label="پنل کاربری" className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden">
        <ul className="flex w-max gap-2">
          {PANEL_LINKS.map((l) => {
            const href = `/${slug}/${l.path}`;
            const active = isActive(pathname, href);
            return (
              <li key={l.path}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm ${active ? "border-primary bg-primary text-on-primary" : "border-border bg-card text-muted-foreground"}`}
                >
                  <l.icon aria-hidden className="size-4" />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
