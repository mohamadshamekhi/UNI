"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { QueryView } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { MEMBERSHIP_STATUS } from "@/lib/labels";
import type { MyMembership } from "@/lib/types";

/** Workspace picker: platform administration and/or the universities the user belongs to. */
export default function Home() {
  const me = useMe();
  const memberships = useQuery({ queryKey: ["my-memberships"], queryFn: () => api<MyMembership[]>("/v1/me/memberships") });

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-xl font-bold">انتخاب محیط کار</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{me.data ? `${me.data.fullName}، کدام بخش را مدیریت می‌کنید؟` : "…"}</p>

      <ul className="flex flex-col gap-2">
        {me.data?.isPlatformAdmin && (
          <li>
            <Link href="/platform/tenants" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary">
              <ShieldCheck aria-hidden className="size-5 text-primary" />
              <span className="flex-1">
                <span className="block font-medium">مدیریت سامانه</span>
                <span className="block text-xs text-muted-foreground">سازمان‌ها، ماژول‌ها و ممیزی سراسری</span>
              </span>
              <ChevronLeft aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          </li>
        )}
      </ul>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">سازمان‌های من</h2>
      <QueryView query={memberships} isEmpty={(d) => d.length === 0} empty={<p className="text-sm text-muted-foreground">عضویتی ندارید.</p>}>
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((m) => {
              const st = MEMBERSHIP_STATUS[m.status];
              const content = (
                <>
                  <Building2 aria-hidden className="size-5 text-muted-foreground" />
                  <span className="flex-1 font-medium">{m.tenantNameFa}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {m.status === "active" && <ChevronLeft aria-hidden className="size-4 text-muted-foreground" />}
                </>
              );
              return (
                <li key={m.id}>
                  {m.status === "active" ? (
                    <Link href={`/t/${m.tenantSlug}`} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 opacity-75">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryView>
    </main>
  );
}
