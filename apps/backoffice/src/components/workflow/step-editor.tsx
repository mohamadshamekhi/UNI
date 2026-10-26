"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { caseAction } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import type { FormFieldDef } from "@uni/shared/types";
import { STEP_TYPE, type Assignee, type Definition, type Scope, type Sla, type Step } from "./model";

const SCOPES: Record<Scope, string> = { tenant: "کل دانشگاه", case_unit: "واحد پرونده", case_unit_tree: "واحد پرونده و واحدهای بالاتر" };
const PRESET_ACTIONS = ["approve", "reject", "return_for_fix", "forward"];
const FIELD_TYPES: Record<FormFieldDef["type"], string> = {
  text: "متن کوتاه",
  textarea: "متن بلند",
  number: "عدد",
  select: "فهرست انتخابی",
  date: "تاریخ",
  file: "پیوست",
  checkbox: "بله/خیر",
};
const STEP_ID = /^[a-z][a-z0-9-]{1,40}$/;
const ACTION_ID = /^[a-z][a-z0-9_]{1,30}$/;

export interface RoleOption {
  key: string;
  nameFa: string;
}

/** Side panel for one step; parent owns the definition and applies every change. */
export function StepEditor({
  step,
  def,
  roles,
  issues,
  onChange,
  onRename,
  onDelete,
  onMakeStart,
}: {
  step: Step;
  def: Definition;
  roles: RoleOption[];
  issues: string[];
  onChange: (s: Step) => void;
  onRename: (to: string) => void;
  onDelete: () => void;
  onMakeStart: () => void;
}) {
  const [idDraft, setIdDraft] = useState(step.id);
  const [lastId, setLastId] = useState(step.id);
  if (lastId !== step.id) {
    setLastId(step.id);
    setIdDraft(step.id);
  }
  const idError = idDraft !== step.id && !STEP_ID.test(idDraft) ? "حروف کوچک انگلیسی، عدد و خط تیره؛ حداقل ۲ حرف." : idDraft !== step.id && def.steps.some((s) => s.id === idDraft) ? "این شناسه تکراری است." : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gold">{STEP_TYPE[step.type].label}</p>
          <p className="text-xs text-muted-foreground">{STEP_TYPE[step.type].hint}</p>
        </div>
        <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}>
          <Trash2 aria-hidden className="size-4" />
          حذف مرحله
        </Button>
      </div>
      {issues.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
          {issues.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان" required>
          {(p) => <Input {...p} value={step.title} maxLength={120} onChange={(e) => onChange({ ...step, title: e.target.value })} />}
        </Field>
        <Field label="شناسه" error={idError} hint="در انتقال‌ها و شرط‌ها استفاده می‌شود.">
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value.toLowerCase())}
              onBlur={() => (idDraft !== step.id && !idError ? onRename(idDraft) : setIdDraft(step.id))}
            />
          )}
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox label="مرحله شروع فرایند" checked={def.start === step.id} disabled={def.start === step.id || step.type === "end"} onChange={onMakeStart} />
      </div>

      {step.type === "human" && <HumanFields step={step} roles={roles} onChange={onChange} />}

      {step.type === "decision" && (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-7 text-muted-foreground">
          مسیر این مرحله با شرط انتقال‌های خروجی‌اش انتخاب می‌شود. در جدول انتقال‌ها برای هر مسیر شرط بنویسید و دقیقاً یک انتقال «در غیر این صورت» بگذارید.
        </p>
      )}

      {step.type === "parallel" && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">شاخه‌ها (مرحله‌های انسانی که هم‌زمان باز می‌شوند)</legend>
            <div className="flex flex-col gap-2">
              {def.steps
                .filter((s) => s.type === "human")
                .map((s) => (
                  <Checkbox
                    key={s.id}
                    label={`${s.title} (${s.id})`}
                    checked={step.branches.includes(s.id)}
                    onChange={(e) => onChange({ ...step, branches: e.target.checked ? [...step.branches, s.id] : step.branches.filter((b) => b !== s.id) })}
                  />
                ))}
            </div>
          </fieldset>
          <Field label="ادامه پس از">
            {(p) => (
              <Select {...p} value={step.join} onChange={(e) => onChange({ ...step, join: e.target.value as "all" | "any" })}>
                <option value="all">انجام همه شاخه‌ها</option>
                <option value="any">انجام اولین شاخه</option>
              </Select>
            )}
          </Field>
          <p className="text-xs text-muted-foreground">شاخه‌ها انتقال خروجی ندارند؛ پس از تکمیل، از تنها انتقال خروجی همین مرحله ادامه می‌دهد. اقدام هر شاخه در شرط‌ها با case.decisions.شناسه_شاخه در دسترس است.</p>
        </>
      )}

      {step.type === "system" && (
        <Field label="کار سیستمی">
          {(p) => (
            <Select {...p} value={step.task} onChange={(e) => onChange({ ...step, task: e.target.value as typeof step.task })}>
              <option value="notify">ارسال اعلان</option>
              <option value="request_payment">درخواست پرداخت</option>
              <option value="tag">افزودن برچسب</option>
            </Select>
          )}
        </Field>
      )}

      {step.type === "end" && (
        <Field label="نتیجه">
          {(p) => (
            <Select {...p} value={step.outcome} onChange={(e) => onChange({ ...step, outcome: e.target.value as "success" | "failure" })}>
              <option value="success">تأیید / موفق</option>
              <option value="failure">رد / ناموفق</option>
            </Select>
          )}
        </Field>
      )}
    </div>
  );
}

type Human = Extract<Step, { type: "human" }>;

function HumanFields({ step, roles, onChange }: { step: Human; roles: RoleOption[]; onChange: (s: Step) => void }) {
  const a = step.assignee;
  const mode = "role" in a ? "role" : "membershipId" in a ? "membership" : "dynamic";
  const setAssignee = (x: Assignee) => onChange({ ...step, assignee: x });
  const [custom, setCustom] = useState("");
  const addAction = (name: string) => {
    if (!ACTION_ID.test(name) || step.actions.includes(name) || step.actions.length >= 8) return;
    onChange({ ...step, actions: [...step.actions, name] });
  };

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">مسئول مرحله</h3>
        <Field label="نوع تخصیص">
          {(p) => (
            <Select
              {...p}
              value={mode}
              onChange={(e) =>
                setAssignee(e.target.value === "role" ? { role: roles[0]?.key ?? "expert", scope: "case_unit_tree" } : e.target.value === "membership" ? { membershipId: "" } : { dynamic: "data." })
              }
            >
              <option value="role">نقش (همه دارندگان نقش در دامنه پرونده)</option>
              <option value="membership">شخص مشخص</option>
              <option value="dynamic">از اطلاعات پرونده (مثل استاد راهنما)</option>
            </Select>
          )}
        </Field>
        {"role" in a && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نقش">
              {(p) => (
                <Select {...p} value={a.role} onChange={(e) => setAssignee({ ...a, role: e.target.value })}>
                  {!roles.some((r) => r.key === a.role) && <option value={a.role}>{a.role} (ناموجود)</option>}
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>{r.nameFa}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="دامنه">
              {(p) => (
                <Select {...p} value={a.scope} onChange={(e) => setAssignee({ ...a, scope: e.target.value as Scope })}>
                  {Object.entries(SCOPES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        {"membershipId" in a && (
          <Field label="شناسه عضویت" hint="شناسه عضویت فرد از صفحه عضویت‌ها.">
            {(p) => <Input {...p} dir="ltr" value={a.membershipId} onChange={(e) => setAssignee({ membershipId: e.target.value.trim() })} />}
          </Field>
        )}
        {"dynamic" in a && (
          <Field label="مسیر داده" hint="مثل data.advisorId؛ مقدار آن شناسه عضویت فرد است. متقاضی هیچ‌وقت مسئول نمی‌شود.">
            {(p) => <Input {...p} dir="ltr" value={a.dynamic} onChange={(e) => setAssignee({ dynamic: e.target.value.trim() })} />}
          </Field>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">اقدام‌ها</h3>
        <ul className="flex flex-wrap gap-2">
          {step.actions.map((x) => (
            <li key={x} className="inline-flex items-center gap-1.5 rounded-full bg-info-bg px-3 py-1 text-sm text-primary">
              {caseAction(x)}
              <code dir="ltr" className="text-[11px] opacity-70">{x}</code>
              <button type="button" aria-label={`حذف اقدام ${caseAction(x)}`} className="cursor-pointer rounded-full p-0.5 hover:bg-card" onClick={() => onChange({ ...step, actions: step.actions.filter((y) => y !== x) })}>
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_ACTIONS.filter((x) => !step.actions.includes(x)).map((x) => (
            <Button key={x} size="sm" variant="secondary" onClick={() => addAction(x)}>
              <Plus aria-hidden className="size-3.5" />
              {caseAction(x)}
            </Button>
          ))}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addAction(custom);
              setCustom("");
            }}
          >
            <Input aria-label="اقدام سفارشی" dir="ltr" className="h-9 w-36" placeholder="custom_action" value={custom} onChange={(e) => setCustom(e.target.value.toLowerCase())} />
            <Button type="submit" size="sm" variant="ghost">افزودن</Button>
          </form>
        </div>
      </section>

      <FormBuilder fields={step.form} onChange={(form) => onChange({ ...step, form })} />
      <SlaFields sla={step.sla} roles={roles} onChange={(sla) => onChange({ ...step, sla })} />
    </>
  );
}

function FormBuilder({ fields, onChange }: { fields: FormFieldDef[]; onChange: (f: FormFieldDef[]) => void }) {
  const set = (i: number, patch: Partial<FormFieldDef>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">فرم مرحله</h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={fields.length >= 30}
          onClick={() => onChange([...fields, { key: `field${fields.length + 1}`, type: "text", label: "فیلد جدید", required: false, visibility: "public" }])}
        >
          <Plus aria-hidden className="size-3.5" />
          فیلد
        </Button>
      </div>
      {fields.length === 0 && <p className="text-sm text-muted-foreground">این مرحله فرم ندارد؛ مسئول فقط یادداشت و اقدام ثبت می‌کند.</p>}
      <ol className="flex flex-col gap-3">
        {fields.map((f, i) => (
          <li key={i} className="rounded-xl bg-muted/50 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="برچسب">{(p) => <Input {...p} value={f.label} maxLength={120} onChange={(e) => set(i, { label: e.target.value })} />}</Field>
              <Field label="کلید">{(p) => <Input {...p} dir="ltr" value={f.key} onChange={(e) => set(i, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} />}</Field>
              <Field label="نوع">
                {(p) => (
                  <Select {...p} value={f.type} onChange={(e) => set(i, { type: e.target.value as FormFieldDef["type"] })}>
                    {Object.entries(FIELD_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {f.type === "select" && (
              <Field label="گزینه‌ها" hint="هر گزینه در یک خط: مقدار|عنوان" className="mt-3">
                {(p) => (
                  <Textarea
                    {...p}
                    dir="auto"
                    className="min-h-20"
                    value={(f.options ?? []).map((o) => `${o.value}|${o.label}`).join("\n")}
                    onChange={(e) =>
                      set(i, {
                        options: e.target.value
                          .split("\n")
                          .map((l) => l.split("|"))
                          .filter(([v]) => v?.trim())
                          .map(([v, l]) => ({ value: v!.trim(), label: (l ?? v)!.trim() })),
                      })
                    }
                  />
                )}
              </Field>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4">
                <Checkbox label="الزامی" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />
                <Checkbox label="داخلی (متقاضی نمی‌بیند)" checked={f.visibility === "internal"} onChange={(e) => set(i, { visibility: e.target.checked ? "internal" : "public" })} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label="بالا" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp aria-hidden className="size-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="پایین" disabled={i === fields.length - 1} onClick={() => move(i, 1)}><ArrowDown aria-hidden className="size-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="حذف فیلد" className="text-danger" onClick={() => onChange(fields.filter((_, j) => j !== i))}><Trash2 aria-hidden className="size-4" /></Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const nums = (s: string) =>
  s
    .split(/[,،\s]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 5);

function SlaFields({ sla, roles, onChange }: { sla?: Sla; roles: RoleOption[]; onChange: (s?: Sla) => void }) {
  const on = !!sla;
  const s: Sla = sla ?? { days: 5, businessDays: true, remindBefore: [1], remindAfter: [1], onOverdue: "notify" };
  const set = (patch: Partial<Sla>) => onChange({ ...s, ...patch });
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <Checkbox label="مهلت انجام (SLA)" description="یادآوری و اقدام خودکار پس از گذشت مهلت" checked={on} onChange={(e) => onChange(e.target.checked ? s : undefined)} />
      {on && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مهلت (روز)">{(p) => <Input {...p} type="number" dir="ltr" min={1} max={365} value={s.days} onChange={(e) => set({ days: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
            <div className="flex items-end pb-2">
              <Checkbox label="روز کاری (بدون تعطیلات)" checked={s.businessDays} onChange={(e) => set({ businessDays: e.target.checked })} />
            </div>
            <Field label="یادآوری چند روز قبل" hint="مثل 3, 1">{(p) => <Input {...p} dir="ltr" defaultValue={s.remindBefore.join(", ")} onBlur={(e) => set({ remindBefore: nums(e.target.value) })} />}</Field>
            <Field label="یادآوری چند روز بعد از مهلت" hint="مثل 1, 3">{(p) => <Input {...p} dir="ltr" defaultValue={s.remindAfter.join(", ")} onBlur={(e) => set({ remindAfter: nums(e.target.value) })} />}</Field>
            <Field label="پس از گذشت مهلت">
              {(p) => (
                <Select {...p} value={s.onOverdue} onChange={(e) => set({ onOverdue: e.target.value as Sla["onOverdue"] })}>
                  <option value="notify">فقط اعلان</option>
                  <option value="escalate">ارجاع به سطح بالاتر</option>
                  <option value="extend">تمدید خودکار یک‌باره</option>
                  <option value="cancel">لغو پرونده</option>
                  <option value="close">بستن پرونده (رد)</option>
                </Select>
              )}
            </Field>
            {s.onOverdue === "escalate" && (
              <Field label="ارجاع به نقش">
                {(p) => (
                  <Select {...p} value={s.escalateTo?.role ?? ""} onChange={(e) => set({ escalateTo: e.target.value ? { role: e.target.value, scope: "case_unit_tree" } : undefined })}>
                    <option value="">فقط علامت‌گذاری</option>
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>{r.nameFa}</option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {s.onOverdue === "extend" && (
              <Field label="تمدید (روز)">{(p) => <Input {...p} type="number" dir="ltr" min={1} max={60} value={s.extendDays ?? 3} onChange={(e) => set({ extendDays: Number(e.target.value) || 3 })} />}</Field>
            )}
          </div>
        </>
      )}
    </section>
  );
}
