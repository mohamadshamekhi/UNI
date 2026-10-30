"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Wallet } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDate, fmtRial } from "@uni/shared/format";
import { PAYMENT_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { PaymentRow } from "@uni/shared/types";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

/** The payer's requests: what is due, what was paid, receipts (PAY-09). */
export default function MyPaymentsPage() {
  const slug = useTenantSlug();
  const q = useQuery({ queryKey: ["my-payments", slug], queryFn: () => api<PaymentRow[]>("/v1/me/payments", { tenant: slug }) });
  const due = (q.data ?? []).filter((p) => p.status === "created" || p.status === "failed" || p.status === "pending");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <p className="text-sm text-white/70">امور مالی</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">پرداخت‌های من</h1>
        <p className="mt-2 max-w-xl leading-7 text-white/75">
          {due.length ? `${new Intl.NumberFormat("fa-IR").format(due.length)} پرداخت منتظر شماست.` : "مبلغ هر پرداخت را سامانه از تعرفه دانشگاه تعیین می‌کند؛ اطلاعات کارت فقط در صفحه بانک وارد می‌شود."}
        </p>
      </section>
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Wallet} title="پرداختی ندارید" />}>
        {(list) => (
          <ul className="grid gap-3">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/${slug}/payments/${p.id}`} className="group flex items-center gap-4 rounded-3xl border border-border bg-card p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold">{p.title}</p>
                      <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">{fmtRial(p.amount)}</span> · <span dir="ltr" className="font-mono">{p.trackingCode}</span>
                      {p.paidAt ? <> · پرداخت {fmtDate(p.paidAt)}</> : p.expiresAt && p.status !== "cancelled" ? <> · مهلت {fmtDate(p.expiresAt)}</> : null}
                    </p>
                  </div>
                  <ChevronLeft aria-hidden className="size-5 text-muted-foreground transition-transform group-hover:-translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
