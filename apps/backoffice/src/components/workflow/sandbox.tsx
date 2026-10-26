"use client";

import { FlaskConical, RotateCcw } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { CASE_EVENT, caseAction } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { CaseStatusBadge, eventTone, Timeline } from "@uni/shared/ui/case";
import { Dialog } from "@uni/shared/ui/dialog";
import { Field, Textarea } from "@uni/shared/ui/field";
import { FormFields, type FormValues } from "@uni/shared/ui/form-fields";
import type { CaseStatusCategory, FormFieldDef } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";
import type { Definition, Issue } from "./model";

interface SimResult {
  ok: boolean;
  issues?: Issue[];
  error?: { code: string; message: string };
  status: CaseStatusCategory;
  path: { type: string; step: string | null; action: string | null; toStep: string | null }[];
  open: { stepId: string; step: string; actions: string[]; form: FormFieldDef[]; assignee: string }[];
  data: Record<string, unknown>;
}

interface ScriptStep {
  action: string;
  form?: FormValues;
}

/**
 * Sandbox (WF-15): runs the saved version against a simulated case. Every click re-runs the whole
 * script from the start, so what you see is exactly what the engine would do; nothing is stored.
 */
export function Sandbox({ open, onClose, versionId, def }: { open: boolean; onClose: () => void; versionId: string; def: Definition }) {
  const slug = useSlug();
  const [data, setData] = useState<FormValues>({});
  const [json, setJson] = useState("{}");
  const [script, setScript] = useState<ScriptStep[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [forms, setForms] = useState<Record<string, FormValues>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = async (next: ScriptStep[]) => {
    setPending(true);
    setError(null);
    try {
      const payload = def.requestForm.length ? data : JSON.parse(json || "{}");
      const r = await api<SimResult>(`/v1/admin/workflow-versions/${versionId}/simulate`, { method: "POST", tenant: slug, body: { data: payload, script: next } });
      setResult(r);
      // a failed last step is not kept, so the user can pick another action
      setScript(r.ok ? next : next.slice(0, -1));
      setForms({});
    } catch (e) {
      setError(e instanceof SyntaxError ? "JSON اطلاعات درخواست معتبر نیست." : errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  const reset = () => {
    setScript([]);
    setResult(null);
  };

  return (
    <Dialog open={open} onClose={onClose} wide title="اجرای آزمایشی">
      <div className="flex flex-col gap-5">
        <p className="rounded-xl bg-info-bg px-4 py-3 text-sm leading-7 text-primary">
          نسخه ذخیره‌شده روی یک پرونده فرضی اجرا می‌شود؛ چیزی ثبت نمی‌شود و اعلانی ارسال نمی‌شود. شما نقش متقاضی را دارید و اقدام هر مرحله را خودتان انتخاب می‌کنید.
        </p>
        <section aria-label="اطلاعات درخواست" className="flex flex-col gap-3">
          <h3 className="text-sm font-bold">اطلاعات درخواست</h3>
          {def.requestForm.length ? (
            <FormFields fields={def.requestForm} values={data} onChange={setData} errors={{}} tenant={slug} showInternal={false} />
          ) : (
            <Field label="داده پرونده (JSON)" hint='مثل {"degree": "msc", "advisorId": "…"}'>
              {(p) => <Textarea {...p} dir="ltr" className="min-h-20 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />}
            </Field>
          )}
          <div className="flex gap-2">
            <Button loading={pending && !script.length} onClick={() => run([])}>
              <FlaskConical aria-hidden className="size-4" />
              {result ? "اجرای دوباره از ابتدا" : "شروع"}
            </Button>
            {result && (
              <Button variant="ghost" onClick={reset}>
                <RotateCcw aria-hidden className="size-4" />
                پاک کردن
              </Button>
            )}
          </div>
        </section>

        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

        {result?.issues && (
          <ul role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
            <li className="mb-1 font-semibold">ابتدا مشکلات تعریف را برطرف کنید:</li>
            {result.issues.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        )}

        {result && !result.issues && (
          <div className="grid gap-5 md:grid-cols-2">
            <section aria-label="مسیر طی‌شده">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-bold">مسیر طی‌شده</h3>
                <CaseStatusBadge status={result.status} />
              </div>
              <Timeline
                items={result.path.map((e, i) => ({
                  key: String(i),
                  title: e.type === "action" ? `${e.step}: ${caseAction(e.action)}` : e.type === "entered" ? `ورود به «${e.step}»` : e.type === "decided" ? `${e.step} ← ${e.toStep}` : (CASE_EVENT[e.type] ?? e.type),
                  at: new Date().toISOString(),
                  tone: eventTone(e.type, e.action),
                }))}
              />
            </section>
            <section aria-label="منتظر اقدام" className="flex flex-col gap-3">
              <h3 className="text-sm font-bold">منتظر اقدام</h3>
              {result.error && (
                <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
                  {result.error.message}
                </p>
              )}
              {result.open.length === 0 && <p className="text-sm text-muted-foreground">پرونده به پایان رسید.</p>}
              {result.open.map((o) => (
                <div key={o.stepId} className="flex flex-col gap-3 rounded-xl border border-border p-3">
                  <div>
                    <p className="font-semibold">{o.step}</p>
                    <p className="text-xs text-muted-foreground">{o.assignee}</p>
                  </div>
                  {o.form.length > 0 && (
                    <FormFields fields={o.form} values={forms[o.stepId] ?? {}} onChange={(v) => setForms({ ...forms, [o.stepId]: v })} errors={{}} tenant={slug} />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {o.actions.map((a) => (
                      <Button key={a} size="sm" variant="secondary" disabled={pending} onClick={() => run([...script, { action: a, form: forms[o.stepId] }])}>
                        {caseAction(a)}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </Dialog>
  );
}
