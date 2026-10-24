"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { api } from "@uni/shared/api";
import { fmtNum } from "@uni/shared/format";
import { useCan, useSlug } from "@/lib/hooks";
import type { MembershipStatus } from "@uni/shared/types";

function useCount(slug: string, status: MembershipStatus, enabled: boolean) {
  return useQuery({
    queryKey: ["membership-count", slug, status],
    queryFn: () => api<{ total: number }>("/v1/admin/memberships", { tenant: slug, query: { status, limit: 1 } }),
    enabled,
  });
}

export default function TenantDashboard() {
  const slug = useSlug();
  const can = useCan(slug);
  const canView = can("membership.view");
  const pending = useCount(slug, "pending_review", canView);
  const revision = useCount(slug, "needs_revision", canView);
  const active = useCount(slug, "active", canView);

  const tiles = [
    { label: "در انتظار بررسی", q: pending, status: "pending_review" },
    { label: "نیازمند اصلاح", q: revision, status: "needs_revision" },
    { label: "اعضای فعال", q: active, status: "active" },
  ];

  return (
    <>
      <PageHeader title="پیشخوان" />
      {canView ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {tiles.map((t) => (
            <Link key={t.status} href={`/t/${slug}/memberships?status=${t.status}`} className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary">
              <p className="text-sm text-muted-foreground">{t.label}</p>
              <p className="mt-2 text-2xl font-bold tabular">{t.q.isPending ? "…" : fmtNum(t.q.data?.total ?? 0)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">برای شما بخش مدیریتی فعالی در این سازمان تعریف نشده است.</p>
        </Card>
      )}
    </>
  );
}
