"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@uni/shared/api";
import { useParams } from "next/navigation";

export interface PublicTenant {
  slug: string;
  nameFa: string;
  nameEn: string | null;
  branding: { primaryColor?: string; displayName?: string; logoFileId?: string };
  calendar: "jalali" | "gregorian";
  enabledModules: string[];
}

export interface PublicUnit {
  id: string;
  nameFa: string;
  nameEn: string | null;
  typeId: string;
  children: PublicUnit[];
}

export const useTenantSlug = () => useParams<{ tenant: string }>().tenant;

export function usePublicTenant(slug: string) {
  return useQuery({ queryKey: ["public-tenant", slug], queryFn: () => api<PublicTenant>("/v1/public/tenant", { tenant: slug, public: true }), retry: false });
}

export function usePublicUnits(slug: string) {
  return useQuery({ queryKey: ["public-units", slug], queryFn: () => api<PublicUnit[]>("/v1/public/units", { tenant: slug, public: true }) });
}

/** Tokens are in httpOnly cookies; the client only knows whether /v1/me answers. */
export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ id: string; fullName: string; mobile: string }>("/v1/me", { public: true }).catch(() => null),
    staleTime: 60_000,
  });
}
