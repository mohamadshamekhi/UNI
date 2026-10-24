"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { api } from "./api";
import type { Me, PermissionMap, UnitNode, UnitType } from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/me"), staleTime: 60_000 });

/** Tenant slug of the current /t/[slug] route. */
export function useSlug(): string {
  const { slug } = useParams<{ slug: string }>();
  return slug;
}

export function usePermissions(slug: string) {
  return useQuery({
    queryKey: ["perms", slug],
    queryFn: () => api<PermissionMap>("/v1/me/permissions", { tenant: slug }),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCan(slug: string) {
  const { data } = usePermissions(slug);
  return (code: string) => !!data?.[code]?.length;
}

export function useUnits(slug: string) {
  const tree = useQuery({ queryKey: ["units", slug], queryFn: () => api<UnitNode[]>("/v1/admin/units", { tenant: slug }) });
  const types = useQuery({ queryKey: ["unit-types", slug], queryFn: () => api<UnitType[]>("/v1/admin/unit-types", { tenant: slug }) });
  const flat = useMemo(() => {
    const out: (UnitNode & { label: string })[] = [];
    const walk = (nodes: UnitNode[], prefix: string) => {
      for (const n of nodes) {
        const label = prefix ? `${prefix} › ${n.nameFa}` : n.nameFa;
        out.push({ ...n, label });
        walk(n.children, label);
      }
    };
    walk(tree.data ?? [], "");
    return out;
  }, [tree.data]);
  const byId = useMemo(() => new Map(flat.map((u) => [u.id, u])), [flat]);
  return { tree, types, flat, byId };
}
