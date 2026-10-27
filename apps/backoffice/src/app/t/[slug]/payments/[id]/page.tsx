"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDateTime, fmtRial } from "@uni/shared/format";
import { PAYMENT_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { ReasonDialog } from "@uni/shared/ui/dialog";
import { Card, Dl, PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { PaymentDetail } from "@uni/shared/types";
import { useCan, useSlug } from "@/lib/hooks";

const ATTEMPT: Record<string, string> = { started: "در جریان", succeeded: "موفق", failed: "ناموفق", unknown: "نامشخص", cancelled: "لغو" };
const EVENT: Record<string, string> = {
  created: "ایجاد درخواست",
  attempt_started: "ارسال به بانک",
  attempt_failed: "تلاش ناموفق",
  succeeded: "پرداخت موفق",
  cancelled: "لغو",
  review: "ارجاع به بررسی",
  review_failed: "رد در بررسی مالی",
};

/** One request with gateway details (error codes, PAY-13) and the review decision for unknown results. */
export default function PaymentAdminPage() {
  const slug = useSlug();
  const can = useCan(slug);
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [decide, setDecide] = useState<"succeeded" | "failed" | null>(null);
  const q = useQuery({ queryKey: ["payment-admin", slug, id], queryFn: () => api<PaymentDetail>(`/v1/admin/payments/${id}`, { tenant: slug }) });
  return (
    <QueryView query={q}>
      {(p) => (
        <>
          <Link href={`/t/${slug}/payments`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight aria-hidden className="size-4" />
            پرداخت‌ها
          </Link>
          <PageHeader eyebrow={p.trackingCode} title={p.title} actions={<Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>} />
          <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
            <div className="flex min-w-0 flex-col gap-5">
              <Card title="تلاش‌های پرداخت">
                {p.attempts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">هنوز تلاشی برای پرداخت انجام نشده است.</p>
                ) : (
                  <Table caption="تلاش‌های پرداخت">
                    <thead>
                      <tr>
                        <Th>زمان</Th>
                        <Th>درگاه</Th>
                        <Th>وضعیت</Th>
                        <Th>کد مرجع / خطا</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.attempts.map((a) => (
                        <tr key={a.id}>
                          <Td className="whitespace-nowrap">{fmtDateTime(a.startedAt)}</Td>
                          <Td>{a.adapter}</Td>
                          <Td>{ATTEMPT[a.status] ?? a.status}</Td>
                          <Td>
                            {a.referenceId && <span dir="ltr" className="font-mono">{a.referenceId}</span>}
                            {a.errorCode && (
                              <span className="text-danger">
                                <span dir="ltr" className="font-mono">{a.errorCode}</span> {a.errorMessage}
                              </span>
                            )}
                            {a.authority && <p dir="ltr" className="font-mono text-xs text-muted-foreground">{a.authority}</p>}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
              <Card title="تاریخچه">
                <ol className="flex flex-col gap-3 border-s border-border ps-4 text-sm">
                  {p.history.map((h, i) => (
                    <li key={i}>
                      <p className="font-semibold">{EVENT[h.type] ?? h.type}</p>
                      <p className="text-xs text-muted-foreground">{h.actor ?? "سامانه"} · {fmtDateTime(h.occurredAt)}</p>
                      {typeof h.data.reason === "string" && <p className="mt-0.5 text-muted-foreground">{h.data.reason}</p>}
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
            <aside className="flex flex-col gap-5">
              <Card title="مشخصات">
                <Dl
                  items={[
                    ["مبلغ", <span key="a" className="font-bold">{fmtRial(p.amount)}</span>],
                    ["پرداخت‌کننده", p.payer?.fullName ?? "—"],
                    ["کد خدمت", <span key="s" dir="ltr" className="font-mono">{p.serviceKey}</span>],
                    ["ارجاع", p.refType === "case" ? <Link key="c" href={`/t/${slug}/cases/${p.refId}`} className="text-primary underline">پرونده</Link> : p.refType === "event_registration" ? "ثبت‌نام رویداد" : "—"],
                    ["ایجاد", fmtDateTime(p.createdAt)],
                    ["مهلت", fmtDateTime(p.expiresAt)],
                    ["پرداخت", fmtDateTime(p.paidAt)],
                    ["رسید", p.receipt ? <span key="r" dir="ltr" className="font-mono">{p.receipt.receiptNo}</span> : "—"],
                  ]}
                />
              </Card>
              {p.status === "review" && can("payment.manage") && (
                <Card title="تصمیم کارشناس مالی">
                  <p className="mb-3 text-sm leading-7 text-muted-foreground">نتیجه بانک نامشخص است. پس از تطبیق با گزارش درگاه، نتیجه را ثبت کنید؛ تصمیم در ممیزی ثبت می‌شود.</p>
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => setDecide("succeeded")}>واریز تأیید شد</Button>
                    <Button variant="secondary" onClick={() => setDecide("failed")}>واریز انجام نشده</Button>
                  </div>
                </Card>
              )}
            </aside>
          </div>
          <ReasonDialog
            open={!!decide}
            onClose={() => setDecide(null)}
            danger={decide === "failed"}
            title={decide === "succeeded" ? "ثبت پرداخت موفق" : "ثبت پرداخت ناموفق"}
            description={decide === "succeeded" ? "رسید صادر و روند مربوط (پرونده یا ثبت‌نام) ادامه می‌یابد." : "پرداخت‌کننده می‌تواند دوباره پرداخت کند."}
            submitLabel="ثبت تصمیم"
            onConfirm={async (reason) => {
              await api(`/v1/admin/payments/${id}/review`, { method: "POST", tenant: slug, body: { outcome: decide, reason } });
              toast("تصمیم ثبت شد.");
              await qc.invalidateQueries({ queryKey: ["payment-admin", slug, id] });
            }}
          />
        </>
      )}
    </QueryView>
  );
}
