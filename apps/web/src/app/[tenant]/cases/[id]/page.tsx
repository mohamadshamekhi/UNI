"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CornerUpLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { CASE_EVENT, CASE_STATUS, caseAction } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { caseRef, CurrentSteps, eventTone, Timeline } from "@uni/shared/ui/case";
import { ReasonDialog } from "@uni/shared/ui/dialog";
import { Field, Textarea } from "@uni/shared/ui/field";
import { QueryView } from "@uni/shared/ui/states";
import type { ApplicantCase } from "@uni/shared/types";
import { HERO_PILL } from "@/components/site/hero-pill";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

const STATUS_COPY: Record<ApplicantCase["statusCategory"], string> = {
  open: "درخواست شما در جریان بررسی است. هر تغییر با اعلان به شما خبر داده می‌شود.",
  revising: "کارشناس اصلاح درخواست را خواسته است؛ توضیحات را ببینید و اصلاحیه را ارسال کنید.",
  success: "رسیدگی به درخواست شما با نتیجه مثبت به پایان رسید.",
  failure: "درخواست شما تأیید نشد. توضیحات را در تاریخچه ببینید.",
  cancelled: "این درخواست لغو شده است.",
};

function CaseInner() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const q = useQuery({ queryKey: ["my-case", slug, id], queryFn: () => api<ApplicantCase>(`/v1/cases/${id}`, { tenant: slug }) });
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href={`/${slug}/cases`} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        پرونده‌های من
      </Link>
      <QueryView query={q}>
        {(c) => (
          <>
            {sp.get("created") && c.statusCategory === "open" && (
              <p role="status" className="enter flex items-center gap-2 rounded-2xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
                <CheckCircle2 aria-hidden className="size-5" />
                درخواست شما ثبت و برای بررسی ارجاع شد.
              </p>
            )}
            <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
              <HeroBackdrop />
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0">
                  <p className="text-sm text-white/70">
                    {c.workflowName} · <span className="font-mono" dir="ltr">{caseRef(c.id)}</span>
                  </p>
                  <h1 className="mt-1 text-2xl font-black sm:text-3xl">{c.title || c.workflowName}</h1>
                </div>
                <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${HERO_PILL[CASE_STATUS[c.statusCategory].tone]}`}>
                  <span aria-hidden className="size-2 rounded-full bg-current" />
                  {CASE_STATUS[c.statusCategory].label}
                </span>
              </div>
              <p className="mt-6 max-w-2xl leading-7 text-white/80">{STATUS_COPY[c.statusCategory]}</p>
            </section>

            <section aria-label="مرحله فعلی" className="rounded-3xl border border-border bg-card p-6">
              <p className="mb-3 text-sm font-semibold text-muted-foreground">مرحله فعلی</p>
              <CurrentSteps steps={c.current.filter((s) => s.stepId !== "@applicant")} status={c.statusCategory} />
              {c.statusCategory === "revising" && <p className="mt-1 text-sm text-warning">منتظر اصلاحیه شما</p>}
            </section>

            {c.revisionTaskId && <Revision c={c} />}

            {typeof c.data.description === "string" && (
              <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                <h2 className="text-lg font-bold">شرح درخواست</h2>
                <p className="mt-3 leading-8 whitespace-pre-line">{c.data.description}</p>
              </section>
            )}

            <section aria-labelledby="history" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
              <h2 id="history" className="mb-6 text-lg font-bold">تاریخچه پرونده</h2>
              <Timeline
                items={c.history.map((e, i) => ({
                  key: `${i}`,
                  title: e.type === "action" ? `${e.step}: ${caseAction(e.action)}` : e.type === "entered" ? `ورود به «${e.step}»` : (CASE_EVENT[e.type] ?? e.type),
                  at: e.occurredAt,
                  tone: eventTone(e.type, e.action),
                  children: e.note ? <p className="rounded-lg bg-muted px-3 py-2 leading-7">{e.note}</p> : undefined,
                }))}
              />
            </section>
          </>
        )}
      </QueryView>
    </div>
  );
}

/** Returned for revision: the reviewer's message, a reply and an updated description. */
function Revision({ c }: { c: ApplicantCase }) {
  const slug = useTenantSlug();
  const qc = useQueryClient();
  const lastNote = [...c.history].reverse().find((e) => e.type === "action" && e.note)?.note;
  const [note, setNote] = useState("");
  const [description, setDescription] = useState(typeof c.data.description === "string" ? c.data.description : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const act = (action: "resubmit" | "withdraw", body: Record<string, unknown>) =>
    api(`/v1/cases/${c.id}/tasks/${c.revisionTaskId}/actions`, { method: "POST", tenant: slug, body: { action, expectedVersion: c.lockVersion, ...body } });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-case", slug, c.id] });
    qc.invalidateQueries({ queryKey: ["my-cases", slug] });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await act("resubmit", { publicNote: note.trim() || undefined, data: { description: description.trim() } });
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="revision" className="enter relative overflow-hidden rounded-3xl border border-warning/40 bg-card p-6 sm:p-8">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-warning" />
      <h2 id="revision" className="flex items-center gap-2 text-lg font-bold">
        <CornerUpLeft aria-hidden className="size-5 text-warning" />
        اصلاح درخواست
      </h2>
      {lastNote && (
        <p className="mt-4 rounded-2xl bg-warning-bg px-4 py-3 text-sm leading-7 text-warning">
          <span className="font-semibold">پیام کارشناس: </span>
          {lastNote}
        </p>
      )}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="شرح درخواست (اصلاح‌شده)">
          {(p) => <Textarea {...p} className="min-h-32" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label="پاسخ به کارشناس" hint="توضیح دهید چه چیزی را اصلاح کرده‌اید.">
          {(p) => <Textarea {...p} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={pending}>ارسال اصلاحیه</Button>
          <Button variant="secondary" size="lg" disabled={pending} onClick={() => setWithdraw(true)}>انصراف از درخواست</Button>
        </div>
      </form>
      <ReasonDialog
        open={withdraw}
        onClose={() => setWithdraw(false)}
        title="انصراف از درخواست"
        description="با انصراف، پرونده بسته می‌شود و قابل بازگشت نیست."
        submitLabel="انصراف از درخواست"
        onConfirm={async (reason) => {
          await act("withdraw", { publicNote: reason });
          refresh();
        }}
      />
    </section>
  );
}

export default function CasePage() {
  return (
    <Suspense>
      <CaseInner />
    </Suspense>
  );
}
