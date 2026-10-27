"use client";

import { setUnauthorizedHandler } from "@uni/shared/api";
import { Logo } from "@uni/shared/ui/logo";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import { NotificationBell } from "@uni/shared/ui/notifications";
import { ThemeToggle } from "@uni/shared/ui/theme";
import { CalendarDays, ChevronLeft, FileText, Newspaper, FolderOpen, GraduationCap, LogIn, LogOut, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CONTAINER, TenantMark } from "@/components/site/tenant-mark";
import { usePublicTenant, useSession, useTenantSlug, type PublicTenant } from "@/lib/tenant";

const HEX = /^#[0-9a-f]{6}$/i;

/** Applicant links open in the portal; staff (panel) links are not followed here. */
const portalLink = (link: string | null) => (link && !link.startsWith("/t/") ? link : null);

export default function TenantLayout({ children }: { children: ReactNode }) {
  const slug = useTenantSlug();
  const pathname = usePathname();
  const tenant = usePublicTenant(slug);

  useEffect(() => {
    setUnauthorizedHandler(() => window.location.assign(`/${slug}/login?next=${encodeURIComponent(window.location.pathname)}`));
  }, [slug]);

  if (tenant.isPending) {
    return (
      <main id="main" className={`${CONTAINER} py-24`}>
        <Loading />
      </main>
    );
  }
  if (tenant.error) {
    return (
      <main id="main" className={`${CONTAINER} max-w-xl py-24`}>
        <ErrorState error={tenant.error} />
        <Link href="/" className="mt-4 inline-block text-primary underline">انتخاب دانشگاه دیگر</Link>
      </main>
    );
  }

  // UX-10: tenant brand colour without code changes
  const color = tenant.data.branding.primaryColor;
  const style = color && HEX.test(color) ? ({ "--primary": color, "--primary-hover": color, "--ring": color } as CSSProperties) : undefined;
  const landing = pathname === `/${slug}`;

  return (
    <div style={style} className="flex min-h-screen flex-col">
      <TenantHeader slug={slug} tenant={tenant.data} overHero={landing} />
      {/* the landing page draws its own full-bleed hero; inner pages share the site container */}
      <main id="main" className={landing ? "flex-1" : `${CONTAINER} flex-1 pt-28 pb-16`}>
        {children}
      </main>
      <footer className="border-t border-border bg-card">
        <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-4 py-8 text-sm`}>
          <div className="flex items-center gap-2.5">
            <TenantMark slug={slug} tenant={tenant.data} size="sm" />
            <span className="font-semibold">{tenant.data.branding.displayName || tenant.data.nameFa}</span>
          </div>
          <div className="flex items-center gap-5 text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">شرایط و حریم خصوصی</Link>
            <Link href="/" className="inline-flex items-center gap-1 hover:text-foreground">
              همه دانشگاه‌ها
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Mirrors the platform site header: transparent over the hero, frosted once scrolled. */
function TenantHeader({ slug, tenant, overHero }: { slug: string; tenant: PublicTenant; overHero: boolean }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const solid = !overHero || scrolled || open;
  const name = tenant.branding.displayName || tenant.nameFa;
  const link = solid ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white";
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign(`/${slug}`);
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,color] duration-300 ${
        solid ? "border-b border-border/70 bg-background/85 text-foreground backdrop-blur-xl" : "border-b border-transparent text-white"
      }`}
    >
      <div className={`${CONTAINER} flex h-16 items-center gap-4`}>
        <Link href={`/${slug}`} className="flex min-w-0 items-center gap-2.5 font-bold">
          <TenantMark slug={slug} tenant={tenant} />
          <span className="truncate">{name}</span>
        </Link>
        <nav aria-label="حساب کاربری" className="ms-auto hidden items-center gap-1 xl:flex">
          <Link href="/" className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
            <Logo className="size-5" />
            همه دانشگاه‌ها
          </Link>
          <Link href={`/${slug}/news`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
            <Newspaper aria-hidden className="size-4" />
            اخبار
          </Link>
          <Link href={`/${slug}/events`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
            <CalendarDays aria-hidden className="size-4" />
            رویدادها
          </Link>
          <ThemeToggle className={solid ? "hover:bg-muted" : "hover:bg-white/10"} />
          {session.data ? (
            <>
              <NotificationBell tenant={slug} inboxHref={`/${slug}/notifications`} resolve={portalLink} className={solid ? "hover:bg-muted" : "hover:bg-white/10"} />
              <Link href={`/${slug}/me`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
                <UserRound aria-hidden className="size-4" />
                وضعیت من
              </Link>
              <Link href={`/${slug}/cases`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
                <FolderOpen aria-hidden className="size-4" />
                پرونده‌های من
              </Link>
              <Link href={`/${slug}/thesis`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
                <GraduationCap aria-hidden className="size-4" />
                پرونده تحصیلی
              </Link>
              <Link href={`/${slug}/papers`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
                <FileText aria-hidden className="size-4" />
                مقالات
              </Link>
              <button type="button" onClick={logout} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${solid ? "text-danger hover:bg-danger-bg" : "text-white/75 hover:text-white"}`}>
                <LogOut aria-hidden className="size-4" />
                خروج
              </button>
            </>
          ) : (
            <>
              <Link href={`/${slug}/login`} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${link}`}>
                <LogIn aria-hidden className="size-4" />
                ورود
              </Link>
              <Link
                href={`/${slug}/register`}
                className={`ms-1 inline-flex h-10 items-center rounded-full px-5 text-sm font-semibold transition-colors ${solid ? "bg-primary text-on-primary hover:bg-primary-hover" : "bg-white text-[#0b1f52] hover:bg-white/90"}`}
              >
                ثبت‌نام
              </Link>
            </>
          )}
        </nav>
        <div className="ms-auto flex items-center gap-1 xl:hidden">
          <ThemeToggle className={solid ? "hover:bg-muted" : "hover:bg-white/10"} />
          {session.data && <NotificationBell tenant={slug} inboxHref={`/${slug}/notifications`} resolve={portalLink} className={solid ? "hover:bg-muted" : "hover:bg-white/10"} />}
          <button
            type="button"
            aria-label={open ? "بستن منو" : "باز کردن منو"}
            aria-expanded={open}
            aria-controls="tenant-nav"
            onClick={() => setOpen((v) => !v)}
            className={`flex size-11 cursor-pointer items-center justify-center rounded-full ${solid ? "hover:bg-muted" : "hover:bg-white/10"}`}
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="tenant-nav" aria-label="حساب کاربری" className={`${CONTAINER} border-t border-border pb-4 xl:hidden`}>
          {session.data ? (
            <>
              <Link href={`/${slug}/me`} onClick={() => setOpen(false)} className="block px-2 py-3">وضعیت من</Link>
              <Link href={`/${slug}/cases`} onClick={() => setOpen(false)} className="block px-2 py-3">پرونده‌های من</Link>
              <Link href={`/${slug}/thesis`} onClick={() => setOpen(false)} className="block px-2 py-3">پرونده تحصیلی</Link>
              <Link href={`/${slug}/papers`} onClick={() => setOpen(false)} className="block px-2 py-3">مقالات من</Link>
              <button type="button" onClick={logout} className="block w-full cursor-pointer px-2 py-3 text-start text-danger">خروج</button>
            </>
          ) : (
            <>
              <Link href={`/${slug}/login`} onClick={() => setOpen(false)} className="block px-2 py-3">ورود</Link>
              <Link href={`/${slug}/register`} onClick={() => setOpen(false)} className="mt-2 flex h-11 items-center justify-center rounded-full bg-primary font-semibold text-on-primary">ثبت‌نام</Link>
            </>
          )}
          <Link href={`/${slug}/news`} onClick={() => setOpen(false)} className="block px-2 py-3">اخبار</Link>
          <Link href={`/${slug}/events`} onClick={() => setOpen(false)} className="block px-2 py-3">رویدادها</Link>
          <Link href="/" onClick={() => setOpen(false)} className="block px-2 py-3 text-muted-foreground">همه دانشگاه‌ها</Link>
        </nav>
      )}
    </header>
  );
}
