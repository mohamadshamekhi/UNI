"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Search, Wallet, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDateTime, fmtNum, fmtRial } from "@uni/shared/format";
import { PAYMENT_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Input } from "@uni/shared/ui/field";
import { Card, PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { PaymentStatus } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

interface Row {
  id: string;
  trackingCode: string;
  title: string;
  serviceKey: string;
  amount: number;
  status: PaymentStatus;
  payer: string;
  createdAt: string;
  paidAt: string | null;
}

const TABS: { key: PaymentStatus | ""; label: string }[] = [
  { key: "", label: "همه" },
  { key: "review", label: "در انتظار بررسی" },
  { key: "succeeded", label: "موفق" },
  { key: "pending", label: "در حال پرداخت" },
  { key: "created", label: "منتظر پرداخت" },
  { key: "failed", label: "ناموفق" },
  { key: "cancelled", label: "لغوشده" },
];

/** Finance desk: all payment requests, the review queue and today's reconciliation (PAY-07/11). */
export default function PaymentsAdminPage() {
  const slug = useSlug();
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: ["payments-admin", slug, status, q],
    queryFn: () => api<{ items: Row[]; total: number }>("/v1/admin/payments", { tenant: slug, query: { status, q, limit: 100 } }),
  });
  const recon = useQuery({
    queryKey: ["payments-recon", slug],
    queryFn: () =>
      api<{ requests: number; requestTotal: number; transactions: number; transactionTotal: number; mismatched: number; balanced: boolean }>("/v1/admin/payments/reconciliation", {
        tenant: slug,
        query: { day: new Date().toISOString() },
      }),
  });

  return (
    <>
      <PageHeader eyebrow="امور مالی" title="پرداخت‌ها" description="مبلغ هر درخواست هنگام ساخت از تعرفه برداشته می‌شود؛ نتیجه پرداخت فقط با استعلام سرور به سرور ثبت می‌شود." />
      {recon.data && (
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className={`inline-flex items-center gap-1.5 font-semibold ${recon.data.balanced ? "text-success" : "text-danger"}`}>
              {recon.data.balanced ? <CheckCircle2 aria-hidden className="size-5" /> : <XCircle aria-hidden className="size-5" />}
              مطابقت امروز {recon.data.balanced ? "بدون اختلاف" : "دارای اختلاف"}
            </span>
            <span>درخواست‌های موفق: {fmtNum(recon.data.requests)} ({fmtRial(recon.data.requestTotal)})</span>
            <span>تراکنش‌های موفق: {fmtNum(recon.data.transactions)} ({fmtRial(recon.data.transactionTotal)})</span>
            {recon.data.mismatched > 0 && <span className="text-danger">ناهماهنگ: {fmtNum(recon.data.mismatched)}</span>}
          </div>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="وضعیت" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.key || "all"} role="tab" type="button" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={`h-9 cursor-pointer rounded-full px-3.5 text-sm ${status === t.key ? "bg-primary text-on-primary" : "bg-muted/60 hover:bg-muted"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="relative ms-auto w-full max-w-xs">
          <span className="sr-only">جستجو</span>
          <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" />
          <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="شناسه پیگیری یا نام پرداخت‌کننده" className="ps-9" />
        </label>
      </div>
      <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={Wallet} title="پرداختی در این فهرست نیست" />}>
        {(d) => (
          <Table caption="پرداخت‌ها">
            <thead>
              <tr>
                <Th>شناسه پیگیری</Th>
                <Th>بابت</Th>
                <Th>پرداخت‌کننده</Th>
                <Th>مبلغ</Th>
                <Th>وضعیت</Th>
                <Th>زمان</Th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((p) => (
                <tr key={p.id} className="hover:bg-muted/40">
                  <Td>
                    <Link href={`/t/${slug}/payments/${p.id}`} dir="ltr" className="font-mono font-semibold hover:text-primary hover:underline">{p.trackingCode}</Link>
                  </Td>
                  <Td>{p.title}</Td>
                  <Td>{p.payer}</Td>
                  <Td className="whitespace-nowrap font-semibold">{fmtRial(p.amount)}</Td>
                  <Td><Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge></Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(p.paidAt ?? p.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}
