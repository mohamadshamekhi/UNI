"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarPlus, Lock, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { fmtDateTime, toFaDigits } from "@uni/shared/format";
import { CASE_EVENT, caseAction, MEMBERSHIP_KIND } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { AttachmentList, caseRef, CaseStatusBadge, CurrentSteps, DueBadge, eventTone, Timeline } from "@uni/shared/ui/case";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { Card, Dl, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { CaseTask, MembershipRow, StaffCase } from "@uni/shared/types";
import { FormFields, type FormValues } from "@uni/shared/ui/form-fields";
import { useCan, useSlug } from "@/lib/hooks";

export default function CasePage() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["case", slug, id], queryFn: () => api<StaffCase>(`/v1/cases/${id}`, { tenant: slug }) });
  return (
    <>
      <Link href={`/t/${slug}/tasks`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        کارتابل
      </Link>
      <QueryView query={q}>{(c) => (c.view === "staff" ? <Detail c={c} /> : <p className="text-sm">این پرونده متعلق به شماست؛ آن را از پورتال دنبال کنید.</p>)}</QueryView>
    </>
  );
}

const DATA_LABELS: Record<string, string> = { description: "شرح درخواست", degree: "مقطع", advisorId: "استاد راهنما" };
const valueText = (v: unknown, files: Set<string>) =>
  typeof v === "boolean" ? (v ? "بله" : "خیر") : Array.isArray(v) ? `${toFaDigits(String(v.length))} پیوست` : typeof v === "string" && files.has(v) ? "۱ پیوست" : String(v ?? "—");

function Detail({ c }: { c: StaffCase }) {
  const slug = useSlug();
  const can = useCan(slug);
  const mine = c.tasks.filter((t) => t.status === "open" && t.canAct);
  const openTasks = c.tasks.filter((t) => t.status === "open");
  const [reassign, setReassign] = useState<CaseTask | null>(null);
  const [extend, setExtend] = useState<CaseTask | null>(null);
  const fileSet = new Set(c.attachments.map((a) => a.id));

  return (
    <>
      <PageHeader
        eyebrow={`${c.workflowName} · ${caseRef(c.id)}`}
        title={c.title || `پرونده ${caseRef(c.id)}`}
        description={c.applicant ? `${c.applicant.fullName} · ${MEMBERSHIP_KIND[c.applicant.kind]}${c.applicant.memberNo ? ` · ${toFaDigits(c.applicant.memberNo)}` : ""}` : undefined}
        actions={<CaseStatusBadge status={c.statusCategory} />}
      />
      <div className="mb-5 rounded-2xl border border-border bg-card px-5 py-4">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">مرحله فعلی</p>
        <CurrentSteps steps={c.current} status={c.statusCategory} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {mine.map((t) => (
            <ActionPanel key={t.id} c={c} task={t} />
          ))}

          <Card title="اطلاعات درخواست">
            {Object.keys(c.data).length ? (
              <Dl items={Object.entries(c.data).map(([k, v]) => [c.labels[k] ?? DATA_LABELS[k] ?? k, valueText(v, fileSet)] as [string, string])} />
            ) : (
              <p className="text-sm text-muted-foreground">اطلاعات تکمیلی ثبت نشده است.</p>
            )}
            {Object.keys(c.internal).length > 0 && (
              <div className="mt-5 rounded-xl border border-dashed border-border p-4">
                <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Lock aria-hidden className="size-3.5" />
                  یادداشت‌ها و فیلدهای داخلی (برای متقاضی نمایش داده نمی‌شود)
                </p>
                <Dl items={Object.entries(c.internal).map(([k, v]) => [c.labels[k] ?? k, valueText(v, fileSet)] as [string, string])} />
              </div>
            )}
          </Card>

          <Card title="پیوست‌ها">
            <AttachmentList tenant={slug} items={c.attachments} labels={c.labels} internalKeys={new Set(Object.keys(c.internal))} />
          </Card>

          <Card title="کارهای پرونده">
            <ul className="flex flex-col divide-y divide-border">
              {c.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.step}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.status === "open" ? "باز" : t.status === "done" ? `انجام شد${t.action ? `: ${caseAction(t.action)}` : ""}` : "لغو شد"}
                      {t.assigneeType === "role" && t.roleKey ? ` · نقش ${t.roleKey}` : t.assigneeType === "applicant" ? " · متقاضی" : " · شخص مشخص"}
                      {t.completedAt && ` · ${fmtDateTime(t.completedAt)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {t.status === "open" && <DueBadge dueAt={t.dueAt} overdue={!!t.overdueAt} />}
                    {t.status === "open" && can("case.assign") && t.assigneeType !== "applicant" && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setReassign(t)}>
                          <UserRoundCog aria-hidden className="size-4" />
                          ارجاع
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setExtend(t)}>
                          <CalendarPlus aria-hidden className="size-4" />
                          تمدید
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {openTasks.length > 0 && mine.length === 0 && <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">کار بازی از این پرونده در کارتابل شما نیست.</p>}
          </Card>
        </div>

        <Card title="تاریخچه پرونده">
          <Timeline
            items={c.history.map((e, i) => ({
              key: `${i}`,
              title: e.type === "action" ? `${e.step}: ${caseAction(e.action)}` : e.type === "entered" ? `ورود به «${e.step}»` : (CASE_EVENT[e.type] ?? e.type),
              at: e.occurredAt,
              tone: eventTone(e.type, e.action),
              meta: e.actorName,
              children:
                e.publicNote || e.internalNote ? (
                  <>
                    {e.publicNote && <p className="rounded-lg bg-muted px-3 py-2">{e.publicNote}</p>}
                    {e.internalNote && (
                      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs">
                        <span className="font-semibold">داخلی: </span>
                        {e.internalNote}
                      </p>
                    )}
                  </>
                ) : undefined,
            }))}
          />
        </Card>
      </div>

      <ReassignDialog c={c} task={reassign} onClose={() => setReassign(null)} />
      <ExtendDialog c={c} task={extend} onClose={() => setExtend(null)} />
    </>
  );
}

/** The current user's task on this case: step form, notes and one button per action. */
function ActionPanel({ c, task }: { c: StaffCase; task: CaseTask }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const step = c.steps.find((s) => s.id === task.stepId);
  const [values, setValues] = useState<FormValues>({});
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const submit = async (action: string) => {
    setPending(action);
    setError(null);
    setErrors({});
    try {
      await api(`/v1/cases/${c.id}/tasks/${task.id}/actions`, {
        method: "POST",
        tenant: slug,
        body: { action, form: values, publicNote: publicNote.trim() || undefined, internalNote: internalNote.trim() || undefined, expectedVersion: c.lockVersion },
      });
      toast(`اقدام «${caseAction(action)}» ثبت شد.`);
      qc.invalidateQueries({ queryKey: ["case", slug, c.id] });
      qc.invalidateQueries({ queryKey: ["my-tasks", slug] });
    } catch (e) {
      if (e instanceof ApiError && e.details?.fields && typeof e.details.fields === "object") setErrors(e.details.fields as Record<string, string>);
      if (e instanceof ApiError && e.code === "CASE_STALE") qc.invalidateQueries({ queryKey: ["case", slug, c.id] });
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <section aria-label={`اقدام: ${task.step}`} className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-[0_18px_40px_-28px_var(--primary)]">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-primary to-gold" />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div>
          <p className="text-xs font-semibold text-gold">اقدام شما</p>
          <h2 className="font-bold">{task.step}</h2>
        </div>
        <DueBadge dueAt={task.dueAt} overdue={!!task.overdueAt} />
      </header>
      <div className="flex flex-col gap-4 p-5">
        {step?.form && step.form.length > 0 && <FormFields fields={step.form} values={values} onChange={setValues} errors={errors} tenant={slug} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پیام به متقاضی" hint="در تاریخچه‌ای که متقاضی می‌بیند نمایش داده می‌شود.">
            {(p) => <Textarea {...p} value={publicNote} maxLength={2000} onChange={(e) => setPublicNote(e.target.value)} />}
          </Field>
          <Field label="یادداشت داخلی" hint="فقط همکاران می‌بینند.">
            {(p) => <Textarea {...p} value={internalNote} maxLength={2000} onChange={(e) => setInternalNote(e.target.value)} />}
          </Field>
        </div>
        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {(step?.actions ?? []).map((a) => (
            <Button
              key={a}
              variant={a === "reject" ? "danger" : a === "approve" || a === "ok" || a === "accept" ? "primary" : "secondary"}
              loading={pending === a}
              disabled={pending !== null && pending !== a}
              onClick={() => submit(a)}
            >
              {caseAction(a)}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReassignDialog({ c, task, onClose }: { c: StaffCase; task: CaseTask | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [reason, setReason] = useState("");
  const people = useQuery({
    queryKey: ["memberships-pick", slug, q],
    enabled: !!task,
    queryFn: () => api<{ items: MembershipRow[] }>("/v1/admin/memberships", { tenant: slug, query: { status: "active", q: q || undefined, limit: 20 } }),
  });
  return (
    <FormDialog
      open={!!task}
      onClose={onClose}
      title={`ارجاع «${task?.step ?? ""}» به شخص دیگر`}
      submitLabel="ارجاع"
      onSubmit={async () => {
        await api(`/v1/cases/${c.id}/tasks/${task!.id}/reassign`, { method: "POST", tenant: slug, body: { membershipId, reason: reason.trim() } });
        qc.invalidateQueries({ queryKey: ["case", slug, c.id] });
        toast("کار ارجاع شد و به مسئول جدید اطلاع داده می‌شود.");
      }}
    >
      <Field label="جست‌وجوی همکار">
        {(p) => <Input {...p} value={q} placeholder="نام یا شماره پرسنلی" onChange={(e) => setQ(e.target.value)} />}
      </Field>
      <Field label="مسئول جدید" required>
        {(p) => (
          <Select {...p} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
            <option value="">انتخاب کنید</option>
            {people.data?.items.map((m) => (
              <option key={m.id} value={m.id}>{m.fullName}{m.unitNameFa ? ` — ${m.unitNameFa}` : ""}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="دلیل" required hint="در تاریخچه و ممیزی ثبت می‌شود.">
        {(p) => <Textarea {...p} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function ExtendDialog({ c, task, onClose }: { c: StaffCase; task: CaseTask | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState("3");
  return (
    <ReasonDialog
      open={!!task}
      onClose={onClose}
      danger={false}
      title={`تمدید مهلت «${task?.step ?? ""}»`}
      description="یادآوری‌ها بر اساس مهلت جدید دوباره زمان‌بندی می‌شوند."
      submitLabel="تمدید"
      onConfirm={async (reason) => {
        await api(`/v1/cases/${c.id}/tasks/${task!.id}/extend`, { method: "POST", tenant: slug, body: { days: Number(days), reason } });
        qc.invalidateQueries({ queryKey: ["case", slug, c.id] });
        toast("مهلت تمدید شد.");
      }}
    >
      <Field label="تعداد روز" required>
        {(p) => <Input {...p} type="number" min={1} max={60} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} />}
      </Field>
    </ReasonDialog>
  );
}
