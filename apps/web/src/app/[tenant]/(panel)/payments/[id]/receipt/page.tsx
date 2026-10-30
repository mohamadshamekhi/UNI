"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { api } from "@uni/shared/api";
import { fmtDateTime, fmtRial } from "@uni/shared/format";
import { Button } from "@uni/shared/ui/button";
import { QueryView } from "@uni/shared/ui/states";
import { useTenantSlug } from "@/lib/tenant";

interface ReceiptData {
  tenant: string;
  receiptNo: string;
  trackingCode: string;
  title: string;
  amount: number;
  referenceId: string | null;
  issuedAt: string;
  payer: string;
}

/** Printable receipt (PAY-09); "save as PDF" from the print dialog gives the file. */
export default function ReceiptPage() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["receipt", slug, id], queryFn: () => api<ReceiptData>(`/v1/payments/${id}/receipt`, { tenant: slug }) });
  return (
    <QueryView query={q}>
      {(r) => (
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-4 flex justify-end print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden className="size-4" />
              چاپ / ذخیره PDF
            </Button>
          </div>
          <article className="rounded-3xl border border-border bg-card p-8 print:border-0 print:p-0">
            <header className="border-b border-dashed border-border pb-4 text-center">
              <p className="text-sm text-muted-foreground">{r.tenant}</p>
              <h1 className="mt-1 text-xl font-black">رسید پرداخت</h1>
            </header>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              {(
                [
                  ["شماره رسید", <span key="n" dir="ltr" className="font-mono">{r.receiptNo}</span>],
                  ["شناسه پیگیری", <span key="t" dir="ltr" className="font-mono">{r.trackingCode}</span>],
                  ["بابت", r.title],
                  ["پرداخت‌کننده", r.payer],
                  ["مبلغ", <span key="a" className="text-base font-black">{fmtRial(r.amount)}</span>],
                  ["کد مرجع بانک", <span key="ref" dir="ltr" className="font-mono">{r.referenceId ?? "—"}</span>],
                  ["زمان", fmtDateTime(r.issuedAt)],
                ] as [string, React.ReactNode][]
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </article>
        </div>
      )}
    </QueryView>
  );
}
