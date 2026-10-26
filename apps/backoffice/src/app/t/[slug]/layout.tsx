"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@uni/shared/api";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import { ArrowRight, Building, FolderKanban, Inbox, LayoutDashboard, Lock, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { useMe, usePermissions, useSlug } from "@/lib/hooks";

interface PublicTenant {
  nameFa: string;
}

/** Menu is built from effective permissions, not role names (section 16). */
export default function TenantLayout({ children }: { children: ReactNode }) {
  const slug = useSlug();
  const perms = usePermissions(slug);
  const tenant = useQuery({ queryKey: ["public-tenant", slug], queryFn: () => api<PublicTenant>("/v1/public/tenant", { tenant: slug }) });
  const base = `/t/${slug}`;
  const has = (code: string) => !!perms.data?.[code]?.length;

  const nav: NavItem[] = [
    { href: base, label: "پیشخوان", icon: LayoutDashboard, exact: true, group: "نمای کلی" },
    { href: `${base}/tasks`, label: "کارتابل", icon: Inbox, group: "نمای کلی" },
    ...(has("case.view.scope") ? [{ href: `${base}/cases`, label: "پرونده‌ها", icon: FolderKanban, group: "نمای کلی" }] : []),
    ...(has("membership.view") ? [{ href: `${base}/memberships`, label: "عضویت‌ها", icon: Users, group: "اعضا و ساختار" }] : []),
    ...(has("unit.manage") ? [{ href: `${base}/units`, label: "ساختار سازمانی", icon: Building, group: "اعضا و ساختار" }] : []),
    ...(has("role.manage") ? [{ href: `${base}/roles`, label: "نقش‌ها و دسترسی", icon: ShieldCheck, group: "اعضا و ساختار" }] : []),
    ...(has("audit.view") ? [{ href: `${base}/audit`, label: "ممیزی", icon: ScrollText, group: "سامانه" }] : []),
    ...(has("tenant.settings.edit") ? [{ href: `${base}/settings`, label: "تنظیمات", icon: Settings, group: "سامانه" }] : []),
  ];

  const denied = perms.error instanceof ApiError && perms.error.code === "MEMBERSHIP_REQUIRED";
  return (
    <AppShell title={tenant.data?.nameFa ?? "…"} subtitle="پنل مدیریت دانشگاه" nav={denied ? [] : nav}>
      {perms.isPending ? <Loading /> : denied ? <AccessDenied slug={slug} /> : perms.error ? <ErrorState error={perms.error} /> : children}
    </AppShell>
  );
}

/**
 * Platform admins have no tenant data access by default (TEN-03); explain how to get it instead
 * of showing a bare error.
 */
function AccessDenied({ slug }: { slug: string }) {
  const me = useMe();
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-warning-bg text-warning">
        <Lock aria-hidden className="size-8" strokeWidth={1.6} />
      </span>
      <h1 className="mt-5 text-2xl font-black">به این دانشگاه دسترسی ندارید</h1>
      <p className="mt-3 leading-7 text-muted-foreground">
        برای ورود به پنل یک دانشگاه، باید در همان دانشگاه عضویت فعال و نقش مدیریتی داشته باشید.
        {me.data?.isPlatformAdmin && " مدیر کل سامانه به داده دانشگاه‌ها دسترسی خودکار ندارد؛ می‌توانید خودتان را از پنل مدیر کل به‌عنوان مدیر این دانشگاه معرفی کنید (این اقدام در ممیزی ثبت می‌شود)."}
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {me.data?.isPlatformAdmin && (
          <Link href={`/platform/tenants?q=${encodeURIComponent(slug)}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary shadow-[0_6px_16px_-8px_var(--primary)] hover:bg-primary-hover">
            <ShieldCheck aria-hidden className="size-4" />
            رفتن به پنل مدیر کل
          </Link>
        )}
        <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted/60">
          <ArrowRight aria-hidden className="size-4" />
          انتخاب محیط کار
        </Link>
      </div>
    </div>
  );
}
