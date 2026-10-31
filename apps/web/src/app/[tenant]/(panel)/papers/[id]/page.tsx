"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CornerUpLeft, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDate, toFaDigits } from "@uni/shared/format";
import { PAPER_EVENT, PAPER_STATUS, REVIEW_MODE } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { AttachmentList, Timeline } from "@uni/shared/ui/case";
import { ReasonDialog } from "@uni/shared/ui/dialog";
import { Field, Textarea } from "@uni/shared/ui/field";
import { QueryView } from "@uni/shared/ui/states";
import type { AuthorPaper, CaseAttachment } from "@uni/shared/types";
import { ManuscriptUpload } from "@/components/paper/manuscript-upload";
import { HERO_PILL } from "@/components/site/hero-pill";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

const asAttachment = (f: NonNullable<AuthorPaper["versions"][number]["file"]>, field: string): CaseAttachment => ({ ...f, createdAt: "", field });

function PaperInner() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [withdrawing, setWithdrawing] = useState(false);
  const q = useQuery({ queryKey: ["my-paper", slug, id], queryFn: () => api<AuthorPaper>(`/v1/papers/${id}`, { tenant: slug }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-paper", slug, id] });
    qc.invalidateQueries({ queryKey: ["my-papers", slug] });
  };
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href={`/${slug}/papers`} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        مقالات من
      </Link>
      <QueryView query={q}>
        {(p) => {
          const st = PAPER_STATUS[p.status];
          const rounds = [...new Set(p.reviews.map((r) => r.round))];
          return (
            <>
              {sp.get("submitted") && p.trackingCode && (
                <p role="status" className="enter flex items-center gap-2 rounded-2xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
                  <CheckCircle2 aria-hidden className="size-5" />
                  مقاله ثبت شد. شناسه پیگیری: <span dir="ltr" className="font-mono font-bold">{p.trackingCode}</span>
                </p>
              )}
              <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
                <HeroBackdrop />
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="min-w-0">
                    <p className="text-sm text-white/70">
                      {p.conference ? `همایش «${p.conference.title}»` : p.trackName} · داوری {REVIEW_MODE[p.reviewMode].label}
                      {p.trackingCode && <> · <span dir="ltr" className="font-mono">{p.trackingCode}</span></>}
                    </p>
                    <h1 className="mt-1 text-2xl font-black sm:text-3xl">{p.title}</h1>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${HERO_PILL[st.tone]}`}>
                    <span aria-hidden className="size-2 rounded-full bg-current" />
                    {st.label}
                  </span>
                </div>
                <p className="mt-6 text-sm text-white/80">
                  دور داوری: {toFaDigits(String(Math.max(p.round, 1)))}
                  {p.status === "revision_requested" && p.revisionDueAt && <> · مهلت ارسال نسخه اصلاح‌شده: {fmtDate(p.revisionDueAt)}</>}
                </p>
              </section>

              {p.decisionNote && (
                <section className="rounded-3xl border border-border bg-card p-6">
                  <h2 className="mb-2 font-bold">یادداشت مدیر بررسی</h2>
                  <p className="leading-8 whitespace-pre-line">{p.decisionNote}</p>
                </section>
              )}

              {p.canRevise && <Revision p={p} onDone={refresh} />}

              {rounds.length > 0 && (
                <section aria-labelledby="reviews" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                  <h2 id="reviews" className="mb-5 flex items-center gap-2 text-lg font-bold">
                    <MessageSquareText aria-hidden className="size-5 text-primary" />
                    نظر داوران
                  </h2>
                  {rounds.map((round) => (
                    <div key={round} className="mb-6 last:mb-0">
                      <p className="mb-3 text-sm font-semibold text-gold">دور {toFaDigits(String(round))}</p>
                      <ul className="flex flex-col gap-3">
                        {p.reviews
                          .filter((r) => r.round === round)
                          .map((r, i) => (
                            <li key={i} className="rounded-2xl bg-muted/60 px-4 py-3">
                              <p className="mb-1 text-sm font-bold">{r.reviewer}</p>
                              <p className="text-sm leading-7 whitespace-pre-line">{r.commentsToAuthor}</p>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )}

              <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                <h2 className="mb-4 font-bold">نسخه‌ها</h2>
                <AttachmentList
                  tenant={slug}
                  items={p.versions.flatMap((v) => [
                    ...(v.file ? [asAttachment(v.file, `v${v.round}`)] : []),
                    ...(v.responseFile ? [asAttachment(v.responseFile, `r${v.round}`)] : []),
                  ])}
                  labels={Object.fromEntries(p.versions.flatMap((v) => [[`v${v.round}`, `نسخه دور ${toFaDigits(String(v.round))}`], [`r${v.round}`, `پاسخ به داوران — دور ${toFaDigits(String(v.round))}`]]))}
                />
              </section>

              <section aria-labelledby="history" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                <h2 id="history" className="mb-6 text-lg font-bold">تاریخچه</h2>
                <Timeline
                  items={p.history.map((e, i) => ({
                    key: String(i),
                    title: PAPER_EVENT[e.type] ?? e.type,
                    at: e.date ? `${e.date}T12:00:00Z` : new Date().toISOString(),
                    tone: e.type === "decided" ? (e.data.decision === "reject" ? "danger" : "success") : e.type.includes("revision") || e.type.includes("request_fix") ? "warning" : e.type === "withdrawn" || e.type.includes("reject") ? "danger" : "info",
                    meta: `دور ${toFaDigits(String(e.round))}`,
                    children: e.note ? <p className="rounded-lg bg-muted px-3 py-2 leading-7">{e.note}</p> : undefined,
                  }))}
                />
              </section>

              {p.canWithdraw && (
                <div className="flex justify-end">
                  <Button variant="ghost" className="text-danger" onClick={() => setWithdrawing(true)}>انصراف و پس گرفتن مقاله</Button>
                </div>
              )}
              <ReasonDialog
                open={withdrawing}
                onClose={() => setWithdrawing(false)}
                title="انصراف از ارسال مقاله"
                description="داوری متوقف می‌شود و به داوران فعال اطلاع داده می‌شود."
                submitLabel="انصراف"
                onConfirm={async (reason) => {
                  await api(`/v1/papers/${p.id}/withdraw`, { method: "POST", tenant: slug, body: { reason } });
                  refresh();
                }}
              />
            </>
          );
        }}
      </QueryView>
    </div>
  );
}

/** PAP-07: revised manuscript with the response to reviewers. */
function Revision({ p, onDone }: { p: AuthorPaper; onDone: () => void }) {
  const slug = useTenantSlug();
  const [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [letter, setLetter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError("نسخه اصلاح‌شده را بارگذاری کنید.");
    setPending(true);
    setError(null);
    try {
      await api(`/v1/papers/${p.id}/revision`, { method: "POST", tenant: slug, body: { manuscriptFileId: file.id, responseLetter: letter.trim() || undefined } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-labelledby="revise" className="enter relative overflow-hidden rounded-3xl border border-warning/40 bg-card p-6 sm:p-8">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-warning" />
      <h2 id="revise" className="mb-5 flex items-center gap-2 text-lg font-bold">
        <CornerUpLeft aria-hidden className="size-5 text-warning" />
        ارسال نسخه اصلاح‌شده
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <ManuscriptUpload tenant={slug} value={file} onChange={setFile} blind={p.reviewMode === "double_blind"} label="نسخه اصلاح‌شده" />
        <Field label="پاسخ به نظر داوران" hint="برای هر نظر توضیح دهید چه تغییری داده‌اید.">
          {(f) => <Textarea {...f} className="min-h-40" value={letter} maxLength={10000} onChange={(e) => setLetter(e.target.value)} />}
        </Field>
        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" loading={pending} className="self-start">ارسال برای دور بعد</Button>
      </form>
    </section>
  );
}

export default function PaperPage() {
  return (
    <Suspense>
      <PaperInner />
    </Suspense>
  );
}
