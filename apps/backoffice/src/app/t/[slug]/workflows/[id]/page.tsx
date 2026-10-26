"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Cog, Copy, Flag, FlaskConical, GitFork, Plus, Rocket, Save, ShieldCheck, Split, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDate, fmtNum, toFaDigits } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input } from "@uni/shared/ui/field";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { Loading, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import {
  blankStep,
  issueStep,
  issueTransition,
  newStepId,
  normalize,
  removeStep,
  renameStep,
  STEP_TYPE,
  VERSION_STATUS,
  type Definition,
  type Issue,
  type Selector,
  type StepType,
  type VersionRow,
  type WorkflowDetail,
} from "@/components/workflow/model";
import { FormBuilder, StepEditor, type RoleOption } from "@/components/workflow/step-editor";
import { Sandbox } from "@/components/workflow/sandbox";
import { TransitionsEditor } from "@/components/workflow/transitions-editor";
import { useSlug, useUnits } from "@/lib/hooks";

const STEP_ICON: Record<StepType, LucideIcon> = { human: UserRound, decision: Split, parallel: GitFork, system: Cog, end: Flag };

function WorkflowInner() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const wf = useQuery({ queryKey: ["workflow", slug, id], queryFn: () => api<WorkflowDetail>(`/v1/admin/workflows/${id}`, { tenant: slug }) });
  const versionId = sp.get("v") ?? wf.data?.versions[0]?.id;
  const version = useQuery({
    queryKey: ["workflow-version", slug, versionId],
    enabled: !!versionId,
    queryFn: () => api<VersionRow>(`/v1/admin/workflow-versions/${versionId}`, { tenant: slug }),
  });

  const newVersion = async () => {
    try {
      const v = await api<{ id: string }>(`/v1/admin/workflows/${id}/versions`, { method: "POST", tenant: slug, body: {} });
      await qc.invalidateQueries({ queryKey: ["workflow", slug, id] });
      router.replace(`?v=${v.id}`);
      toast("نسخه جدید از روی آخرین نسخه ساخته شد.");
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <>
      <Link href={`/t/${slug}/workflows`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        گردش‌کارها
      </Link>
      <QueryView query={wf}>
        {(w) => (
          <>
            <PageHeader
              eyebrow={w.requestType}
              title={w.nameFa}
              description={w.description ?? undefined}
              actions={
                <>
                  <Button variant="ghost" onClick={() => setCopying(true)}>
                    <Copy aria-hidden className="size-4" />
                    کپی برای واحد
                  </Button>
                  <Button variant="secondary" onClick={newVersion}>
                    <Plus aria-hidden className="size-4" />
                    نسخه جدید
                  </Button>
                </>
              }
            />
            <nav aria-label="نسخه‌ها" className="mb-5 flex gap-2 overflow-x-auto pb-1">
              {w.versions.map((v) => {
                const active = v.id === versionId;
                return (
                  <Link
                    key={v.id}
                    href={`?v=${v.id}`}
                    replace
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "flex shrink-0 flex-col gap-1 rounded-2xl border px-4 py-2.5 text-sm transition-colors",
                      active ? "border-primary bg-info-bg" : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      نسخه {toFaDigits(String(v.version))}
                      <Badge tone={VERSION_STATUS[v.status].tone}>{VERSION_STATUS[v.status].label}</Badge>
                    </span>
                    <span className="text-xs text-muted-foreground tabular">
                      {fmtDate(v.publishedAt ?? v.createdAt)}
                      {v.openCases > 0 && ` · ${fmtNum(v.openCases)} پرونده جاری`}
                    </span>
                  </Link>
                );
              })}
            </nav>
            <CopyDialog open={copying} onClose={() => setCopying(false)} w={w} />
            {version.isPending ? <Loading /> : version.data ? <Designer key={version.data.id} v={version.data} workflowId={w.id} /> : null}
          </>
        )}
      </QueryView>
    </>
  );
}

function Designer({ v, workflowId }: { v: VersionRow; workflowId: string }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { flat: units } = useUnits(slug);
  const roles = useQuery({ queryKey: ["roles", slug], queryFn: () => api<RoleOption[]>("/v1/admin/roles", { tenant: slug }) });
  const [def, setDef] = useState<Definition>(() => normalize(v.definition));
  const [selector, setSelector] = useState<Selector>(v.selector);
  const [issues, setIssues] = useState<Issue[]>(v.issues ?? []);
  const [selected, setSelected] = useState(v.definition.start);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "validate" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const readOnly = v.status === "published" || v.status === "retired";

  // warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = (next: Definition) => {
    setDef(next);
    setDirty(true);
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["workflow", slug, workflowId] });
    qc.invalidateQueries({ queryKey: ["workflow-version", slug, v.id] });
  };

  const save = async () => {
    await api(`/v1/admin/workflow-versions/${v.id}`, { method: "PATCH", tenant: slug, body: { definition: def, selector } });
    setDirty(false);
    setIssues([]);
  };
  const run = async (kind: "save" | "validate") => {
    setBusy(kind);
    try {
      if (dirty || kind === "save") await save();
      if (kind === "validate") {
        const r = await api<{ ok: boolean; issues: Issue[] }>(`/v1/admin/workflow-versions/${v.id}/validate`, { method: "POST", tenant: slug, body: {} });
        setIssues(r.issues);
        toast(r.ok ? "تعریف معتبر است و آماده انتشار است." : `${toFaDigits(String(r.issues.length))} مشکل پیدا شد.`);
      } else toast("پیش‌نویس ذخیره شد.");
      refresh();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const byStep = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) {
      const s = issueStep(i);
      if (s) m.set(s, [...(m.get(s) ?? []), i.message]);
    }
    return m;
  }, [issues]);
  const byTransition = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const i of issues) {
      const t = issueTransition(i);
      if (t !== null) m.set(t, [...(m.get(t) ?? []), i.message]);
    }
    return m;
  }, [issues]);

  const step = def.steps.find((s) => s.id === selected) ?? def.steps[0];
  const addStep = (type: StepType) => {
    const id = newStepId(def, type === "end" ? "end" : "step");
    edit({ ...def, steps: [...def.steps, blankStep(type, id)] });
    setSelected(id);
  };
  const st = VERSION_STATUS[v.status];
  const canPublish = v.status === "validated" && !dirty;

  return (
    <>
      <div className="sticky top-16 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={st.tone}>{st.label}</Badge>
          {readOnly ? (
            <span className="text-muted-foreground">نسخه منتشرشده قابل ویرایش نیست؛ برای تغییر «نسخه جدید» بسازید.</span>
          ) : dirty ? (
            <span className="text-warning">تغییرات ذخیره نشده</span>
          ) : (
            <span className="text-muted-foreground">همه تغییرات ذخیره شده</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <>
              <Button variant="secondary" loading={busy === "save"} disabled={!dirty || busy !== null} onClick={() => run("save")}>
                <Save aria-hidden className="size-4" />
                ذخیره
              </Button>
              <Button variant="secondary" loading={busy === "validate"} disabled={busy !== null} onClick={() => run("validate")}>
                <ShieldCheck aria-hidden className="size-4" />
                اعتبارسنجی
              </Button>
              <Button variant="secondary" disabled={dirty || busy !== null} title={dirty ? "ابتدا ذخیره کنید" : undefined} onClick={() => setSandbox(true)}>
                <FlaskConical aria-hidden className="size-4" />
                اجرای آزمایشی
              </Button>
              <Button disabled={!canPublish} onClick={() => setPublishing(true)} title={canPublish ? undefined : "ابتدا ذخیره و اعتبارسنجی کنید"}>
                <Rocket aria-hidden className="size-4" />
                انتشار
              </Button>
            </>
          )}
          {v.status === "published" && (
            <Button variant="danger" onClick={() => setRetiring(true)}>
              بازنشسته کردن
            </Button>
          )}
        </div>
      </div>

      {issues.length > 0 && (
        <section role="alert" aria-label="مشکلات اعتبارسنجی" className="mb-5 rounded-2xl border border-danger/30 bg-danger-bg p-4">
          <p className="mb-2 flex items-center gap-2 font-bold text-danger">
            <AlertTriangle aria-hidden className="size-5" />
            {toFaDigits(String(issues.length))} مشکل باید پیش از انتشار برطرف شود
          </p>
          <ul className="flex flex-col gap-1 text-sm text-danger">
            {issues.map((i, k) => {
              const s = issueStep(i);
              return (
                <li key={k}>
                  {s && def.steps.some((x) => x.id === s) ? (
                    <button type="button" className="cursor-pointer text-start underline-offset-4 hover:underline" onClick={() => setSelected(s)}>
                      {i.message}
                    </button>
                  ) : (
                    i.message
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {v.status === "validated" && !dirty && issues.length === 0 && (
        <p role="status" className="mb-5 flex items-center gap-2 rounded-2xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
          <CheckCircle2 aria-hidden className="size-5" />
          این نسخه معتبر است و می‌توانید آن را منتشر کنید.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="مراحل">
          <ol className="flex flex-col gap-1.5">
            {def.steps.map((s) => {
              const Icon = STEP_ICON[s.type];
              const n = byStep.get(s.id)?.length ?? 0;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={s.id === step?.id ? "true" : undefined}
                    onClick={() => setSelected(s.id)}
                    className={clsx(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-sm transition-colors",
                      s.id === step?.id ? "bg-primary text-on-primary" : "hover:bg-muted",
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className={clsx("block truncate text-[11px]", s.id === step?.id ? "text-on-primary/70" : "text-muted-foreground")} dir="ltr">
                        {s.id}
                      </span>
                    </span>
                    {def.start === s.id && <CircleDot aria-label="شروع" className="size-4 shrink-0 text-gold" />}
                    {n > 0 && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white tabular" aria-label={`${n} مشکل`}>{toFaDigits(String(n))}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          {!readOnly && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">افزودن مرحله</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STEP_TYPE) as StepType[]).map((t) => {
                  const Icon = STEP_ICON[t];
                  return (
                    <Button key={t} size="sm" variant="secondary" className="justify-start" onClick={() => addStep(t)}>
                      <Icon aria-hidden className="size-4" />
                      {STEP_TYPE[t].label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card title={step ? `ویرایش «${step.title}»` : "مرحله"}>
          {step ? (
            <fieldset disabled={readOnly} className="min-w-0">
              <StepEditor
                step={step}
                def={def}
                roles={roles.data ?? []}
                issues={byStep.get(step.id) ?? []}
                onChange={(s) => edit({ ...def, steps: def.steps.map((x) => (x.id === step.id ? s : x)) })}
                onRename={(to) => {
                  edit(renameStep(def, step.id, to));
                  setSelected(to);
                }}
                onDelete={() => {
                  edit(removeStep(def, step.id));
                  setSelected(def.steps.find((x) => x.id !== step.id)?.id ?? "");
                }}
                onMakeStart={() => edit({ ...def, start: step.id })}
              />
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">مرحله‌ای ندارد؛ از ستون کنار یک مرحله اضافه کنید.</p>
          )}
        </Card>
      </div>

      <section aria-label="فرم درخواست" className="mt-4">
        <fieldset disabled={readOnly} className="min-w-0">
          <FormBuilder
            roles={roles.data ?? []}
            title="فرم درخواست (آنچه متقاضی هنگام ثبت پر می‌کند)"
            empty="فرم درخواست تعریف نشده؛ متقاضی فقط عنوان و توضیحات می‌نویسد. فیلدهای این فرم در شرط‌ها با data.کلید در دسترس‌اند."
            allowInternal={false}
            fields={def.requestForm}
            onChange={(requestForm) => edit({ ...def, requestForm })}
          />
        </fieldset>
      </section>

      <section aria-label="محدودیت‌های متقاضی" className="mt-4">
        <Card title="محدودیت‌های متقاضی">
          <fieldset disabled={readOnly} className="flex flex-wrap items-end gap-6">
            <Checkbox
              label="هر متقاضی فقط یک درخواست فعال از این نوع"
              checked={!!def.limits?.onePerApplicant}
              onChange={(e) => edit({ ...def, limits: { onePerApplicant: e.target.checked, reapplyAfterDays: def.limits?.reapplyAfterDays ?? 0 } })}
            />
            <Field label="فاصله ثبت درخواست جدید پس از رد (روز)" className="w-64">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  dir="ltr"
                  min={0}
                  max={3650}
                  value={def.limits?.reapplyAfterDays ?? 0}
                  onChange={(e) => edit({ ...def, limits: { onePerApplicant: !!def.limits?.onePerApplicant, reapplyAfterDays: Math.max(0, Number(e.target.value) || 0) } })}
                />
              )}
            </Field>
          </fieldset>
        </Card>
      </section>

      <section aria-label="انتقال‌ها" className="mt-4">
        <Card title="انتقال‌ها">
          <TransitionsEditor def={def} issues={byTransition} readOnly={readOnly} onChange={(transitions) => edit({ ...def, transitions })} />
        </Card>
      </section>

      <section aria-label="دامنه اجرا" className="mt-4">
        <Card title="این نسخه برای کدام درخواست‌ها اجرا شود؟">
          <fieldset disabled={readOnly} className="flex flex-col gap-4">
            <Field label="مقطع‌ها" hint="خالی یعنی همه مقطع‌ها؛ با ویرگول جدا کنید، مثل msc, phd (از data.degree پرونده).">
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  defaultValue={(selector.degrees ?? []).join(", ")}
                  onBlur={(e) => {
                    const degrees = e.target.value.split(/[,،\s]+/).filter(Boolean);
                    setSelector({ ...selector, degrees: degrees.length ? degrees : undefined });
                    setDirty(true);
                  }}
                />
              )}
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">واحدها (خالی یعنی همه دانشگاه؛ زیرواحدها هم شامل می‌شوند)</legend>
              <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                {units.map((u) => (
                  <Checkbox
                    key={u.id}
                    label={u.label}
                    checked={selector.unitIds?.includes(u.id) ?? false}
                    onChange={(e) => {
                      const ids = e.target.checked ? [...(selector.unitIds ?? []), u.id] : (selector.unitIds ?? []).filter((x) => x !== u.id);
                      setSelector({ ...selector, unitIds: ids.length ? ids : undefined });
                      setDirty(true);
                    }}
                  />
                ))}
              </div>
            </fieldset>
          </fieldset>
        </Card>
      </section>

      <details className="mt-4 rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">تعریف خام (JSON)</summary>
        <pre dir="ltr" className="mt-3 max-h-96 overflow-auto rounded-xl bg-muted p-3 text-xs leading-5">{JSON.stringify({ ...def }, null, 2)}</pre>
      </details>

      <Sandbox open={sandbox} onClose={() => setSandbox(false)} versionId={v.id} def={def} />
      <PublishDialog open={publishing} v={v} onClose={() => setPublishing(false)} onDone={refresh} />
      <ReasonDialog
        open={retiring}
        onClose={() => setRetiring(false)}
        title="بازنشسته کردن نسخه"
        description="پرونده جدید با این نسخه ثبت نمی‌شود؛ پرونده‌های جاری روی همین نسخه ادامه می‌دهند."
        submitLabel="بازنشسته کردن"
        onConfirm={async (reason) => {
          await api(`/v1/admin/workflow-versions/${v.id}/retire`, { method: "POST", tenant: slug, body: { reason } });
          refresh();
          toast("نسخه بازنشسته شد.");
        }}
      />
    </>
  );
}

/** WF-16: show what publishing changes before confirming. */
function PublishDialog({ open, v, onClose, onDone }: { open: boolean; v: VersionRow; onClose: () => void; onDone: () => void }) {
  const slug = useSlug();
  const toast = useToast();
  const impact = useQuery({
    queryKey: ["impact", slug, v.id],
    enabled: open,
    queryFn: () =>
      api<{ replaces: number[]; openCasesOnPrevious: number; conflicts: { workflow: string; version: number }[] }>(`/v1/admin/workflow-versions/${v.id}/impact`, { tenant: slug }),
  });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`انتشار نسخه ${toFaDigits(String(v.version))}`}
      submitLabel="انتشار"
      onSubmit={async () => {
        await api(`/v1/admin/workflow-versions/${v.id}/publish`, { method: "POST", tenant: slug, body: {} });
        onDone();
        toast("نسخه منتشر شد؛ پرونده‌های جدید با این نسخه ثبت می‌شوند.");
      }}
    >
      {impact.isPending ? (
        <Loading rows={2} />
      ) : impact.data ? (
        <ul className="flex flex-col gap-2 text-sm leading-7">
          <li>
            {impact.data.replaces.length
              ? `جایگزین نسخه ${impact.data.replaces.map((n) => toFaDigits(String(n))).join("، ")} می‌شود که بازنشسته خواهد شد.`
              : "اولین نسخه منتشرشده این گردش‌کار است."}
          </li>
          <li>
            {impact.data.openCasesOnPrevious > 0
              ? `${fmtNum(impact.data.openCasesOnPrevious)} پرونده جاری روی نسخه قبلی می‌مانند و با همان قواعد تمام می‌شوند.`
              : "پرونده جاری‌ای تحت تأثیر نیست."}
          </li>
          {impact.data.conflicts.length > 0 && (
            <li role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-danger">
              هم‌پوشانی با: {impact.data.conflicts.map((c) => `${c.workflow} (نسخه ${toFaDigits(String(c.version))})`).join("، ")} — انتشار رد می‌شود؛ دامنه اجرا را محدود کنید.
            </li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-danger">{errorMessage(impact.error)}</p>
      )}
    </FormDialog>
  );
}

/** WF-19: faculty-specific copy; it is narrower than the source, so both can stay published. */
function CopyDialog({ open, onClose, w }: { open: boolean; onClose: () => void; w: WorkflowDetail }) {
  const slug = useSlug();
  const router = useRouter();
  const qc = useQueryClient();
  const { flat: units } = useUnits(slug);
  const [v, setV] = useState({ nameFa: "", key: "", unitIds: [] as string[] });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="کپی گردش‌کار برای یک واحد"
      submitLabel="ساخت کپی"
      onSubmit={async () => {
        const c = await api<{ id: string }>(`/v1/admin/workflows/${w.id}/copy`, { method: "POST", tenant: slug, body: { nameFa: v.nameFa.trim(), key: v.key.trim(), unitIds: v.unitIds } });
        qc.invalidateQueries({ queryKey: ["workflows", slug] });
        router.push(`/t/${slug}/workflows/${c.id}`);
      }}
    >
      <p className="text-sm leading-7 text-muted-foreground">
        آخرین نسخه «{w.nameFa}» به‌عنوان پیش‌نویس یک گردش‌کار جدید کپی می‌شود که فقط برای واحدهای انتخاب‌شده اجرا می‌شود. پس از انتشار، پرونده‌های این واحدها با کپی و بقیه با گردش‌کار اصلی پیش می‌روند.
      </p>
      <Field label="نام" required>
        {(p) => <Input {...p} value={v.nameFa} placeholder={`${w.nameFa} — دانشکده …`} onChange={(e) => setV({ ...v, nameFa: e.target.value })} />}
      </Field>
      <Field label="شناسه" required hint="حروف کوچک انگلیسی و خط تیره">
        {(p) => <Input {...p} dir="ltr" value={v.key} placeholder={`${w.key}-eng`} onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase() })} />}
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">واحدها <span className="text-danger" aria-hidden>*</span></legend>
        <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {units.map((u) => (
            <Checkbox
              key={u.id}
              label={u.label}
              checked={v.unitIds.includes(u.id)}
              onChange={(e) => setV({ ...v, unitIds: e.target.checked ? [...v.unitIds, u.id] : v.unitIds.filter((x) => x !== u.id) })}
            />
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}

export default function WorkflowPage() {
  return (
    <Suspense>
      <WorkflowInner />
    </Suspense>
  );
}
