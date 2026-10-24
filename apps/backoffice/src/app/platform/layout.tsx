"use client";

import { Building2, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ErrorState, Loading } from "@/components/ui/states";
import { useMe } from "@/lib/hooks";

const NAV = [
  { href: "/platform/tenants", label: "سازمان‌ها", icon: Building2 },
  { href: "/platform/audit", label: "ممیزی سراسری", icon: ScrollText },
];

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <AppShell title="مدیریت سامانه" subtitle="مدیر کل" nav={NAV}>
      {me.isPending ? <Loading /> : me.data?.isPlatformAdmin ? children : <ErrorState error={new Error("این بخش فقط برای مدیر کل سامانه است.")} />}
    </AppShell>
  );
}
