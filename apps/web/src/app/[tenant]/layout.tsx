"use client";

import { setUnauthorizedHandler } from "@uni/shared/api";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import { ChevronLeft, Landmark } from "lucide-react";
import Link from "next/link";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ThemeToggle } from "@/components/site/theme";
import { usePublicTenant, useSession, useTenantSlug } from "@/lib/tenant";

const HEX = /^#[0-9a-f]{6}$/i;

export default function TenantLayout({ children }: { children: ReactNode }) {
  const slug = useTenantSlug();
  const tenant = usePublicTenant(slug);
  const session = useSession();

  useEffect(() => {
    setUnauthorizedHandler(() => window.location.assign(`/${slug}/login?next=${encodeURIComponent(window.location.pathname)}`));
  }, [slug]);

  // UX-10: tenant brand colour without code changes
  const color = tenant.data?.branding.primaryColor;
  const style = color && HEX.test(color) ? ({ "--primary": color, "--primary-hover": color, "--ring": color } as CSSProperties) : undefined;

  if (tenant.isPending) return <main id="main" className="mx-auto max-w-xl px-4 py-12"><Loading /></main>;
  if (tenant.error) {
    return (
      <main id="main" className="mx-auto max-w-xl px-4 py-12">
        <ErrorState error={tenant.error} />
        <Link href="/" className="mt-4 inline-block text-primary underline">انتخاب دانشگاه دیگر</Link>
      </main>
    );
  }
  const name = tenant.data.branding.displayName || tenant.data.nameFa;
  return (
    <div style={style} className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={`/${slug}`} className="flex min-w-0 items-center gap-2.5 font-bold">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary">
              <Landmark className="size-5" strokeWidth={1.75} />
            </span>
            <span className="truncate">{name}</span>
          </Link>
          <nav aria-label="حساب کاربری" className="flex items-center gap-1 text-sm">
            <ThemeToggle className="hover:bg-muted" />
            {session.data ? (
              <>
                <Link href={`/${slug}/me`} className="rounded-md px-3 py-2 hover:bg-muted">وضعیت من</Link>
                <button
                  type="button"
                  className="cursor-pointer rounded-md px-3 py-2 text-danger hover:bg-danger-bg"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.assign(`/${slug}`);
                  }}
                >
                  خروج
                </button>
              </>
            ) : (
              <>
                <Link href={`/${slug}/login`} className="rounded-md px-3 py-2 hover:bg-muted">ورود</Link>
                <Link href={`/${slug}/register`} className="hidden h-10 items-center rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover sm:inline-flex">ثبت‌نام</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>{name}</span>
          <Link href="/" className="inline-flex items-center gap-1 hover:text-foreground">
            همه دانشگاه‌ها
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
