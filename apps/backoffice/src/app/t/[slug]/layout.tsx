"use client";

import { useQuery } from "@tanstack/react-query";
import { Building, LayoutDashboard, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { ErrorState, Loading } from "@/components/ui/states";
import { api } from "@/lib/api";
import { usePermissions, useSlug } from "@/lib/hooks";

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
    { href: base, label: "پیشخوان", icon: LayoutDashboard, exact: true },
    ...(has("membership.view") ? [{ href: `${base}/memberships`, label: "عضویت‌ها", icon: Users }] : []),
    ...(has("unit.manage") ? [{ href: `${base}/units`, label: "ساختار سازمانی", icon: Building }] : []),
    ...(has("role.manage") ? [{ href: `${base}/roles`, label: "نقش‌ها و دسترسی", icon: ShieldCheck }] : []),
    ...(has("audit.view") ? [{ href: `${base}/audit`, label: "ممیزی", icon: ScrollText }] : []),
    ...(has("tenant.settings.edit") ? [{ href: `${base}/settings`, label: "تنظیمات", icon: Settings }] : []),
  ];

  return (
    <AppShell title={tenant.data?.nameFa ?? "…"} subtitle="پنل مدیریت دانشگاه" nav={nav}>
      {perms.isPending ? <Loading /> : perms.error ? <ErrorState error={perms.error} /> : children}
    </AppShell>
  );
}
