"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@uni/shared/api";
import { fmtRial } from "@uni/shared/format";
import { Loading } from "@uni/shared/ui/states";
import type { PaymentStatus } from "@uni/shared/types";
import { useTenantSlug } from "@/lib/tenant";

/**
 * The bank sends the payer back here. The query string is only a hint; the server verifies with
 * the gateway (PAY-05) and the answer below is the real result. Reloading is harmless (PAY-06).
 */
export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<Loading rows={2} />}>
      <ReturnInner />
    </Suspense>
  );
}

function ReturnInner() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const authority = useSearchParams().get("authority") ?? "";
  const q = useQuery({
    queryKey: ["payment-return", slug, id, authority],
    enabled: !!authority,
    retry: 1,
    queryFn: () =>
      api<{ status: PaymentStatus; trackingCode: string; amount: number; title: string; receiptNo: string | null }>(`/v1/payments/${id}/verify`, {
        method: "POST",
        tenant: slug,
        public: true,
        body: { authority },
      }),
  });
  if (!authority) return <Result tone="danger" title="پاسخ بانک ناقص است" text="از صفحه پرداخت دوباره اقدام کنید." slug={slug} id={id} />;
  if (q.isPending) return <div className="mx-auto max-w-lg py-10" aria-live="polite"><p className="mb-4 text-center font-semibold">در حال استعلام نتیجه از بانک…</p><Loading rows={2} /></div>;
  const r = q.data;
  if (!r) return <Result tone="pending" title="نتیجه هنوز مشخص نیست" text="اگر مبلغ از حساب شما کم شده، نتیجه تا چند دقیقه دیگر خودکار ثبت می‌شود." slug={slug} id={id} />;
  if (r.status === "succeeded")
    return <Result tone="success" title="پرداخت با موفقیت انجام شد" text={`${fmtRial(r.amount)} بابت «${r.title}» — شناسه پیگیری ${r.trackingCode}`} slug={slug} id={id} receipt />;
  if (r.status === "failed" || r.status === "cancelled") return <Result tone="danger" title="پرداخت انجام نشد" text="مبلغی کسر نشده است؛ می‌توانید دوباره تلاش کنید." slug={slug} id={id} />;
  return <Result tone="pending" title="نتیجه در حال بررسی است" text="اگر مبلغ از حساب شما کم شده، نیازی به پرداخت دوباره نیست؛ نتیجه خودکار ثبت می‌شود." slug={slug} id={id} />;
}

function Result({ tone, title, text, slug, id, receipt }: { tone: "success" | "danger" | "pending"; title: string; text: string; slug: string; id: string; receipt?: boolean }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : Clock;
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-warning";
  return (
    <div role="status" className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-3xl border border-border bg-card p-8 text-center">
      <Icon aria-hidden className={`size-14 ${color}`} />
      <h1 className="text-xl font-black">{title}</h1>
      <p className="leading-7 text-muted-foreground">{text}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {receipt && (
          <Link href={`/${slug}/payments/${id}/receipt`} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
            مشاهده رسید
          </Link>
        )}
        <Link href={`/${slug}/payments/${id}`} className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold">
          جزئیات پرداخت
        </Link>
      </div>
    </div>
  );
}
