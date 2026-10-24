"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum } from "@uni/shared/format";
import { MEMBERSHIP_KIND } from "@uni/shared/labels";
import type { MembershipRow, MembershipStatus } from "@uni/shared/types";
import { Card } from "@uni/shared/ui/layout";
import { ArrowLeft, Building, Clock, PencilLine, ScrollText, Settings, ShieldCheck, UserCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCan, useMe, useSlug } from "@/lib/hooks";

function useCount(slug: string, status: MembershipStatus, enabled: boolean) {
  return useQuery({
    queryKey: ["membership-count", slug, status],
    queryFn: () => api<{ total: number }>("/v1/admin/memberships", { tenant: slug, query: { status, limit: 1 } }),
    enabled,
  });
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "صبح بخیر" : h < 17 ? "روز بخیر" : "عصر بخیر";
};

export default function TenantDashboard() {
  const slug = useSlug();
  const can = useCan(slug);
  const me = useMe();
  const canView = can("membership.view");
  const pending = useCount(slug, "pending_review", canView);
  const revision = useCount(slug, "needs_revision", canView);
  const active = useCount(slug, "active", canView);
  const latest = useQuery({
    queryKey: ["memberships", slug, "latest-pending"],
    queryFn: () => api<{ items: MembershipRow[] }>("/v1/admin/memberships", { tenant: slug, query: { status: "pending_review", limit: 5 } }),
    enabled: canView,
  });

  const stats: { label: string; value?: number; icon: LucideIcon; tint: string; href: string }[] = [
    { label: "در انتظار بررسی", value: pending.data?.total, icon: Clock, tint: "#2f6bff", href: `/t/${slug}/memberships?status=pending_review` },
    { label: "نیازمند اصلاح", value: revision.data?.total, icon: PencilLine, tint: "#b45309", href: `/t/${slug}/memberships?status=needs_revision` },
    { label: "اعضای فعال", value: active.data?.total, icon: UserCheck, tint: "#0f766e", href: `/t/${slug}/memberships?status=active` },
  ];

  const shortcuts: { label: string; desc: string; icon: LucideIcon; href: string; perm: string }[] = [
    { label: "عضویت‌ها", desc: "بررسی و تصمیم درباره درخواست‌ها", icon: Users, href: `/t/${slug}/memberships`, perm: "membership.view" },
    { label: "ساختار سازمانی", desc: "دانشکده‌ها، گروه‌ها و رشته‌ها", icon: Building, href: `/t/${slug}/units`, perm: "unit.manage" },
    { label: "نقش‌ها و دسترسی", desc: "نقش‌های سفارشی و مجوزها", icon: ShieldCheck, href: `/t/${slug}/roles`, perm: "role.manage" },
    { label: "ممیزی", desc: "ردیابی اقدامات حساس", icon: ScrollText, href: `/t/${slug}/audit`, perm: "audit.view" },
    { label: "تنظیمات", desc: "هویت بصری و سیاست‌ها", icon: Settings, href: `/t/${slug}/settings`, perm: "tenant.settings.edit" },
  ].filter((s) => can(s.perm));

  return (
    <div className="flex flex-col gap-6">
      <section className="hero-band relative isolate overflow-hidden rounded-3xl px-6 py-8 sm:px-8">
        <div aria-hidden className="absolute inset-0 -z-10">
          <span className="aurora aurora-1 -top-24 end-0 size-80" />
          <span className="aurora aurora-3 -bottom-24 start-10 size-56" />
          <div className="grid-lines absolute inset-0" />
        </div>
        <p className="text-sm text-white/70">{greeting()}،</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">
          {me.data?.fullName ?? "…"} <span className="text-gold-gradient">خوش آمدید</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-7 text-white/70">
          {canView && pending.data
            ? pending.data.total > 0
              ? `${fmtNum(pending.data.total)} درخواست عضویت منتظر بررسی شماست.`
              : "همه درخواست‌ها بررسی شده‌اند؛ صف شما خالی است."
            : "از منوی کناری بخش موردنظر را انتخاب کنید."}
        </p>
        {canView && (
          <Link href={`/t/${slug}/memberships?status=pending_review`} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#0b1f52] transition hover:bg-gold-bright">
            رفتن به صف بررسی
            <ArrowLeft aria-hidden className="size-4" />
          </Link>
        )}
      </section>

      {canView && (
        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="group rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-20px_rgb(15_23_42/0.18)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-20px_rgb(15_23_42/0.3)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${s.tint}, color-mix(in oklab, ${s.tint} 65%, black))` }}>
                  <s.icon aria-hidden className="size-5" />
                </span>
                <ArrowLeft aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:-translate-x-1" />
              </div>
              <p className="mt-5 text-3xl font-black tabular">{s.value === undefined ? "…" : fmtNum(s.value)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {canView && (
          <Card title="آخرین درخواست‌های در انتظار" actions={<Link href={`/t/${slug}/memberships`} className="text-sm text-primary hover:underline">همه</Link>}>
            {latest.data?.items.length ? (
              <ul className="-my-2 divide-y divide-border">
                {latest.data.items.map((m) => (
                  <li key={m.id}>
                    <Link href={`/t/${slug}/memberships/${m.id}`} className="flex items-center gap-3 py-3 hover:text-primary">
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-bg text-xs font-bold text-primary">
                        {m.fullName.split(/\s+/).slice(0, 2).map((w) => w[0]).join("‌")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {MEMBERSHIP_KIND[m.kind]} · {m.unitNameFa ?? "—"}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground tabular">{fmtDate(m.submittedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{latest.isPending ? "…" : "درخواستی در انتظار نیست."}</p>
            )}
          </Card>
        )}
        <Card title="دسترسی سریع">
          <ul className="grid gap-2">
            {shortcuts.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-info-bg text-primary">
                    <s.icon aria-hidden className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.desc}</span>
                  </span>
                  <ArrowLeft aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
