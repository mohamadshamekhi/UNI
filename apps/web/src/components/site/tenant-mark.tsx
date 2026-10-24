import { Landmark } from "lucide-react";
import type { PublicTenant } from "@/lib/tenant";

/** Same content width as the platform homepage. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/** University logo tile, or a brand-coloured placeholder. */
export function TenantMark({ slug, tenant, size = "md" }: { slug: string; tenant: PublicTenant; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-8 rounded-lg" : "size-9 rounded-xl";
  if (tenant.branding.logoFileId) {
    return (
      <span aria-hidden className={`flex ${box} shrink-0 items-center justify-center overflow-hidden border border-border bg-white p-1`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/proxy/v1/public/tenants/${slug}/logo?v=${tenant.branding.logoFileId}`} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span aria-hidden className={`flex ${box} shrink-0 items-center justify-center bg-primary text-on-primary`}>
      <Landmark className="size-[18px]" strokeWidth={1.75} />
    </span>
  );
}

