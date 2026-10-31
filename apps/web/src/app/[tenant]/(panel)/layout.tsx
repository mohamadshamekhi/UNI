"use client";

import type { ReactNode } from "react";
import { PanelNav } from "@/components/site/user-panel";
import { useSession, useTenantSlug } from "@/lib/tenant";

/** Member panel: personal pages share a side navigation instead of crowding the site header. */
export default function PanelLayout({ children }: { children: ReactNode }) {
  const slug = useTenantSlug();
  const session = useSession();
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
      <PanelNav slug={slug} fullName={session.data?.fullName} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
