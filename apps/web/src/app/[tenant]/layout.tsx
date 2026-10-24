"use client";

import { setUnauthorizedHandler } from "@uni/shared/api";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import Link from "next/link";
import { useEffect, type CSSProperties, type ReactNode } from "react";
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
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
          <Link href={`/${slug}`} className="truncate font-bold">{name}</Link>
          <nav aria-label="حساب کاربری" className="flex items-center gap-1 text-sm">
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
              <Link href={`/${slug}/login`} className="rounded-md px-3 py-2 hover:bg-muted">ورود</Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
