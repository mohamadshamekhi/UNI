"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CreditCard, Lock, Receipt } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtRial } from "@uni/shared/format";
import { PAYMENT_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { QueryView } from "@uni/shared/ui/states";
import type { PaymentDetail } from "@uni/shared/types";
import { useTenantSlug } from "@/lib/tenant";

const ATTEMPT: Record<string, string> = { started: "در جریان", succeeded: "موفق", failed: "ناموفق", unknown: "نامشخص", cancelled: "لغو" };

/** One request: amount fixed by the tariff, attempts and the way to the bank. */
export default function PaymentPage() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payment", slug, id], queryFn: () => api<PaymentDetail>(`/v1/payments/${id}`, { tenant: slug }) });
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // one key per click: a double click or a retried request opens a single bank transaction
  const key = useRef<string | null>(null);

  const pay = async () => {
    setBusy("pay");
    setError(null);
    key.current ??= crypto.randomUUID().replaceAll("-", "");
    try {
      const r = await api<{ redirectUrl: string }>(`/v1/payments/${id}/start`, { method: "POST", tenant: slug, headers: { "idempotency-key": key.current } });
      window.location.assign(r.redirectUrl);
    } catch (e) {
      key.current = null;
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!window.confirm("این درخواست پرداخت لغو شود؟ ممکن است روند مربوط (مثل پرونده یا ثبت‌نام) هم بسته شود.")) return;
    setBusy("cancel");
    try {
      await api(`/v1/payments/${id}/cancel`, { method: "POST", tenant: slug });
      await qc.invalidateQueries({ queryKey: ["payment", slug, id] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <QueryView query={q}>
      {(p) => (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          <Link href={`/${slug}/payments`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight aria-hidden className="size-4" />
            پرداخت‌های من
          </Link>
          <section className="rounded-3xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-black leading-8">{p.title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  شناسه پیگیری: <span dir="ltr" className="font-mono">{p.trackingCode}</span>
                </p>
              </div>
              <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
            </div>
            <p className="mt-6 text-3xl font-black">{fmtRial(p.amount)}</p>
            {p.expiresAt && p.payable && <p className="mt-1 text-sm text-muted-foreground">مهلت پرداخت: {fmtDateTime(p.expiresAt)}</p>}
            {p.status === "review" && <p role="status" className="mt-4 rounded-2xl bg-warning-bg p-3 text-sm leading-7">نتیجه این پرداخت از بانک نامشخص است و کارشناس مالی آن را بررسی می‌کند؛ لازم نیست دوباره پرداخت کنید.</p>}
            {p.status === "pending" && <p role="status" className="mt-4 rounded-2xl bg-muted p-3 text-sm leading-7">اگر پرداخت را در بانک انجام داده‌اید، نتیجه حداکثر تا چند دقیقه دیگر خودکار ثبت می‌شود.</p>}
            {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              {p.payable && (
                <Button loading={busy === "pay"} disabled={!!busy} onClick={() => void pay()}>
                  <CreditCard aria-hidden className="size-4" />
                  {p.status === "failed" ? "تلاش دوباره" : "پرداخت آنلاین"}
                </Button>
              )}
              {(p.status === "created" || p.status === "failed") && (
                <Button variant="ghost" loading={busy === "cancel"} disabled={!!busy} onClick={() => void cancel()}>
                  انصراف از پرداخت
                </Button>
              )}
              {p.receipt && (
                <Link href={`/${slug}/payments/${p.id}/receipt`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted/60">
                  <Receipt aria-hidden className="size-4" />
                  رسید پرداخت
                </Link>
              )}
            </div>
            {p.payable && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock aria-hidden className="size-3.5" />
                اطلاعات کارت فقط در صفحه بانک وارد می‌شود و در این سامانه ذخیره نمی‌شود.
              </p>
            )}
          </section>
          {p.attempts.length > 0 && (
            <section aria-labelledby="att" className="rounded-3xl border border-border bg-card p-5">
              <h2 id="att" className="font-bold">تلاش‌های پرداخت</h2>
              <ul className="mt-3 divide-y divide-border text-sm">
                {p.attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="font-semibold">{ATTEMPT[a.status] ?? a.status}</span>
                    <span className="text-muted-foreground">{fmtDateTime(a.startedAt)}</span>
                    {a.errorMessage && <span className="text-danger">{a.errorMessage}</span>}
                    {a.referenceId && <span dir="ltr" className="ms-auto font-mono text-xs">{a.referenceId}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </QueryView>
  );
}
