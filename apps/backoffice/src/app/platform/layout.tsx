"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@uni/shared/api";
import { Building2, ScrollText, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import { useMe } from "@/lib/hooks";

const NAV = [
  { href: "/platform/tenants", label: "سازمان‌ها", icon: Building2, group: "مدیریت" },
  { href: "/platform/audit", label: "ممیزی سراسری", icon: ScrollText, group: "نظارت" },
];

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const mfa = useQuery({ queryKey: ["mfa"], queryFn: () => api<{ enabled: boolean }>("/v1/auth/2fa"), enabled: !!me.data?.isPlatformAdmin });
  return (
    <AppShell title="مدیریت سامانه" subtitle="پنل مدیر کل" nav={NAV}>
      {mfa.data && !mfa.data.enabled && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
          <ShieldAlert aria-hidden className="size-5" />
          <span className="flex-1">ورود دومرحله‌ای برای حساب مدیر کل فعال نیست؛ برای امنیت سامانه آن را فعال کنید.</span>
          <Link href="/account" className="font-semibold underline">فعال‌سازی</Link>
        </div>
      )}
      {me.isPending ? <Loading /> : me.data?.isPlatformAdmin ? children : <ErrorState error={new Error("این بخش فقط برای مدیر کل سامانه است.")} />}
    </AppShell>
  );
}
