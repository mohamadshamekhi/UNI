"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, CheckCircle2, CornerUpLeft, PencilLine, Save, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { fmtDate } from "@uni/shared/format";
import { CASE_EVENT, CASE_STATUS, caseAction } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { AttachmentList, caseRef, CaseStepper, eventTone, Timeline } from "@uni/shared/ui/case";
import { ReasonDialog } from "@uni/shared/ui/dialog";
import { Field, Input, Textarea } from "@uni/shared/ui/field";
import { type FormValues } from "@uni/shared/ui/form-fields";
import { QueryView } from "@uni/shared/ui/states";
import type { ApplicantCase } from "@uni/shared/types";
import { RequestFormFields } from "@/components/case/request-form";
import { HERO_PILL } from "@/components/site/hero-pill";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

const STATUS_COPY: Record<ApplicantCase["statusCategory"], string> = {
  draft: "این درخواست هنوز ارسال نشده است؛ اطلاعات را کامل و سپس ارسال کنید.",
  open: "درخواست شما در جریان بررسی است. هر تغییر با اعلان به شما خبر داده می‌شود.",
  revising: "اصلاح درخواست از شما خواسته شده است؛ توضیحات را ببینید و اصلاحیه را ارسال کنید.",
  success: "رسیدگی به درخواست شما با نتیجه مثبت به پایان رسید.",
  failure: "درخواست شما تأیید نشد. توضیحات را در تاریخچه ببینید.",
  cancelled: "این درخواست لغو شده است.",
};

const fieldErrorsOf = (e: unknown) =>
  e instanceof ApiError && e.details?.fields && typeof e.details.fields === "object" && !Array.isArray(e.details.fields) ? (e.details.fields as Record<string, string>) : {};

function CaseInner() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const [withdrawing, setWithdrawing] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["my-case", slug, id], queryFn: () => api<ApplicantCase>(`/v1/cases/${id}`, { tenant: slug }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-case", slug, id] });
    qc.invalidateQueries({ queryKey: ["my-cases", slug] });
  };
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

            {c.statusCategory === "draft" ? (
              <DraftEditor c={c} onSaved={refresh} onSubmitted={() => (refresh(), router.replace(`/${slug}/cases/${c.id}?created=1`))} />
            ) : (
              <>
                {c.path.length > 0 && (
                  <section aria-label="پیشرفت پرونده" className="rounded-3xl border border-border bg-card p-6">
                    <CaseStepper path={c.path} current={c.current.map((s) => s.stepId)} status={c.statusCategory} />
                    {c.waiting.length > 0 && (
                      <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
                        {c.waiting.map((w, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2">
                            <AlarmClock aria-hidden className="size-4 text-primary" />
                            در انتظار «{w.step}»
                            {w.dueAt && <span className="text-muted-foreground tabular">· مهلت رسیدگی تا {fmtDate(w.dueAt)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {c.revisionTaskId && <Revision c={c} onDone={refresh} />}

                <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                  <h2 className="text-lg font-bold">اطلاعات درخواست</h2>
                  <RequestData c={c} />
                  {c.attachments.length > 0 && (
                    <div className="mt-6">
                      <h3 className="mb-3 text-sm font-bold">پیوست‌ها</h3>
                      <AttachmentList tenant={slug} items={c.attachments} labels={c.labels} />
                    </div>
                  )}
                </section>

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

            {c.canWithdraw && !c.revisionTaskId && (
              <div className="flex justify-end">
                <Button variant="ghost" className="text-danger" onClick={() => setWithdrawing(true)}>
                  <XCircle aria-hidden className="size-4" />
                  {c.statusCategory === "draft" ? "حذف پیش‌نویس" : "انصراف از درخواست"}
                </Button>
              </div>
            )}
            <ReasonDialog
              open={withdrawing}
              onClose={() => setWithdrawing(false)}
              title={c.statusCategory === "draft" ? "حذف پیش‌نویس" : "انصراف از درخواست"}
              description="پرونده بسته می‌شود و قابل بازگشت نیست."
              submitLabel="تأیید"
              onConfirm={async (reason) => {
                await api(`/v1/cases/${c.id}/withdraw`, { method: "POST", tenant: slug, body: { reason } });
                refresh();
              }}
            />
          </>
        )}
      </QueryView>
    </div>
  );
}

/** THS-01: edit a saved draft, then submit it (validation happens on submit). */
function DraftEditor({ c, onSaved, onSubmitted }: { c: ApplicantCase; onSaved: () => void; onSubmitted: () => void }) {
  const slug = useTenantSlug();
  const [title, setTitle] = useState(c.title ?? "");
  const [values, setValues] = useState<FormValues>(c.data);
  const [description, setDescription] = useState(typeof c.data.description === "string" ? c.data.description : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<"save" | "submit" | null>(null);
  const data = () => (c.requestForm.length ? values : { description: description.trim() });

  const run = async (kind: "save" | "submit") => {
    setPending(kind);
    setError(null);
    setErrors({});
    setSaved(false);
    try {
      await api(`/v1/cases/${c.id}/draft`, { method: "PATCH", tenant: slug, body: { title: title.trim() || undefined, data: data() } });
      if (kind === "submit") {
        await api(`/v1/cases/${c.id}/submit`, { method: "POST", tenant: slug });
        onSubmitted();
      } else {
        setSaved(true);
        onSaved();
      }
    } catch (e) {
      setErrors(fieldErrorsOf(e));
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run("submit");
  };

  return (
    <section aria-labelledby="draft" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <h2 id="draft" className="mb-6 flex items-center gap-2 text-lg font-bold">
        <PencilLine aria-hidden className="size-5 text-primary" />
        تکمیل پیش‌نویس
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="عنوان" required>
          {(p) => <Input {...p} className="h-11" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        {c.requestForm.length ? (
          <RequestFormFields requestType={c.requestType} fields={c.requestForm} values={values} onChange={setValues} errors={errors} />
        ) : (
          <Field label="توضیحات">
            {(p) => <Textarea {...p} className="min-h-32" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        {saved && <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">پیش‌نویس ذخیره شد.</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={pending === "submit"} disabled={pending !== null}>
            <Send aria-hidden className="size-4" />
            ارسال درخواست
          </Button>
          <Button variant="secondary" size="lg" loading={pending === "save"} disabled={pending !== null} onClick={() => run("save")}>
            <Save aria-hidden className="size-4" />
            ذخیره
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Request values with their form labels; file fields are listed under attachments instead. */
function RequestData({ c }: { c: ApplicantCase }) {
  const files = new Set(c.attachments.map((a) => a.id));
  const rows = Object.entries(c.data).filter(([, v]) => !(typeof v === "string" && files.has(v)) && !Array.isArray(v));
  if (!rows.length) return <p className="mt-3 text-sm text-muted-foreground">اطلاعات تکمیلی ثبت نشده است.</p>;
  const member = new Set(c.requestForm.filter((f) => f.type === "member").map((f) => f.key));
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {rows
        .filter(([k]) => !member.has(k))
        .map(([k, v]) => {
          const f = c.requestForm.find((x) => x.key === k);
          const text = typeof v === "boolean" ? (v ? "بله" : "خیر") : (f?.options?.find((o) => o.value === v)?.label ?? String(v));
          return (
            <div key={k} className={k === "description" || f?.type === "textarea" ? "sm:col-span-2" : undefined}>
              <dt className="text-xs text-muted-foreground">{c.labels[k] ?? (k === "description" ? "شرح درخواست" : k)}</dt>
              <dd className="mt-1 leading-7 whitespace-pre-line">{text}</dd>
            </div>
          );
        })}
    </dl>
  );
}

/** Returned for revision (THS-07): only the requested fields, before the deadline. */
function Revision({ c, onDone }: { c: ApplicantCase; onDone: () => void }) {
  const slug = useTenantSlug();
  const lastNote = [...c.history].reverse().find((e) => e.type === "action" && e.note)?.note;
  const fields = c.revision?.fields.length ? c.requestForm.filter((f) => c.revision!.fields.includes(f.key)) : c.requestForm;
  const [note, setNote] = useState("");
  const [description, setDescription] = useState(typeof c.data.description === "string" ? c.data.description : "");
  const [values, setValues] = useState<FormValues>(() => Object.fromEntries(fields.filter((f) => f.key in c.data).map((f) => [f.key, c.data[f.key]])));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`/v1/cases/${c.id}/tasks/${c.revisionTaskId}/actions`, {
        method: "POST",
        tenant: slug,
        body: { action: "resubmit", expectedVersion: c.lockVersion, publicNote: note.trim() || undefined, data: c.requestForm.length ? values : { description: description.trim() } },
      });
      onDone();
    } catch (err) {
      setFieldErrors(fieldErrorsOf(err));
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
      {c.revision?.dueAt && <p className="mt-3 text-sm font-medium tabular">مهلت ارسال اصلاحیه: {fmtDate(c.revision.dueAt)}</p>}
      {c.revision?.fields.length ? <p className="mt-1 text-sm text-muted-foreground">فقط موارد خواسته‌شده قابل ویرایش‌اند.</p> : null}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {c.requestForm.length ? (
          <RequestFormFields requestType={c.requestType} fields={fields} values={values} onChange={setValues} errors={fieldErrors} />
        ) : (
          <Field label="شرح درخواست (اصلاح‌شده)">
            {(p) => <Textarea {...p} className="min-h-32" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        )}
        <Field label="پاسخ به کارشناس" hint="توضیح دهید چه چیزی را اصلاح کرده‌اید.">
          {(p) => <Textarea {...p} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={pending}>ارسال اصلاحیه</Button>
          <WithdrawButton c={c} onDone={onDone} />
        </div>
      </form>
    </section>
  );
}

function WithdrawButton({ c, onDone }: { c: ApplicantCase; onDone: () => void }) {
  const slug = useTenantSlug();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>انصراف از درخواست</Button>
      <ReasonDialog
        open={open}
        onClose={() => setOpen(false)}
        title="انصراف از درخواست"
        description="با انصراف، پرونده بسته می‌شود و قابل بازگشت نیست."
        submitLabel="انصراف از درخواست"
        onConfirm={async (reason) => {
          await api(`/v1/cases/${c.id}/withdraw`, { method: "POST", tenant: slug, body: { reason } });
          onDone();
        }}
      />
    </>
  );
}

export default function CasePage() {
  return (
    <Suspense>
      <CaseInner />
    </Suspense>
  );
}
