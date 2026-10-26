"use client";

import { clsx } from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { caseAction } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { Input, Select } from "@uni/shared/ui/field";
import { APPLICANT, type Definition, type Issue, type Transition } from "./model";

/** Transition table (WF-01): from step → (action / condition) → to step. */
export function TransitionsEditor({
  def,
  issues,
  onChange,
  readOnly,
}: {
  def: Definition;
  issues: Map<number, string[]>;
  onChange: (t: Transition[]) => void;
  readOnly: boolean;
}) {
  const steps = new Map(def.steps.map((s) => [s.id, s]));
  const branchIds = new Set(def.steps.flatMap((s) => (s.type === "parallel" ? s.branches : [])));
  const sources = def.steps.filter((s) => s.type !== "end" && !branchIds.has(s.id));
  const set = (i: number, t: Transition) => onChange(def.transitions.map((x, j) => (j === i ? t : x)));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">انتقال‌ها</caption>
          <thead>
            <tr className="bg-muted/60 text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-start font-semibold">از مرحله</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">با اقدام / شرط</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">به مرحله</th>
              <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">حذف</span></th>
            </tr>
          </thead>
          <tbody>
            {def.transitions.map((t, i) => {
              const from = steps.get(t.from);
              const errs = issues.get(i);
              return (
                <tr key={i} className={clsx("border-t border-border align-top", errs && "bg-danger-bg/40")}>
                  <td className="px-3 py-2">
                    <Select aria-label="از مرحله" value={t.from} disabled={readOnly} onChange={(e) => set(i, { from: e.target.value, to: t.to })}>
                      {!steps.has(t.from) && <option value={t.from}>{t.from} (حذف‌شده)</option>}
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    {from?.type === "human" && (
                      <Select aria-label="اقدام" value={t.action ?? ""} disabled={readOnly} onChange={(e) => set(i, { ...t, action: e.target.value || undefined })}>
                        <option value="">انتخاب اقدام</option>
                        {from.actions.map((a) => (
                          <option key={a} value={a}>{caseAction(a)}</option>
                        ))}
                      </Select>
                    )}
                    {from?.type === "human" && (
                      <Input aria-label="شرط اضافه (اختیاری)" dir="ltr" className="mt-2 font-mono text-xs" placeholder="شرط اختیاری، مثل data.degree == 'phd'" value={t.when ?? ""} disabled={readOnly} onChange={(e) => set(i, { ...t, when: e.target.value || undefined })} />
                    )}
                    {from?.type === "decision" && (
                      <div className="flex flex-col gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!t.otherwise} disabled={readOnly} onChange={(e) => set(i, e.target.checked ? { from: t.from, to: t.to, otherwise: true } : { from: t.from, to: t.to, when: "" })} />
                          در غیر این صورت
                        </label>
                        {!t.otherwise && (
                          <Input aria-label="شرط" dir="ltr" className="font-mono text-xs" placeholder="data.degree == 'phd' || case.internal.committee" value={t.when ?? ""} disabled={readOnly} onChange={(e) => set(i, { ...t, when: e.target.value })} />
                        )}
                      </div>
                    )}
                    {(from?.type === "parallel" || from?.type === "system") && <span className="text-xs text-muted-foreground">خودکار (تنها خروجی)</span>}
                    {errs && (
                      <ul role="alert" className="mt-2 text-xs text-danger">
                        {errs.map((m, k) => (
                          <li key={k}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Select aria-label="به مرحله" value={t.to} disabled={readOnly} onChange={(e) => set(i, { ...t, to: e.target.value })}>
                      {!steps.has(t.to) && t.to !== APPLICANT && <option value={t.to}>{t.to} (حذف‌شده)</option>}
                      {def.steps.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))}
                      <option value={APPLICANT}>بازگشت به متقاضی برای اصلاح</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    {!readOnly && (
                      <Button size="sm" variant="ghost" aria-label="حذف انتقال" className="text-danger" onClick={() => onChange(def.transitions.filter((_, j) => j !== i))}>
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={sources.length === 0}
            onClick={() => onChange([...def.transitions, { from: sources[0]!.id, to: def.steps.find((s) => s.type === "end")?.id ?? sources[0]!.id }])}
          >
            <Plus aria-hidden className="size-3.5" />
            انتقال جدید
          </Button>
        </div>
      )}
      <details className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">راهنمای شرط‌ها</summary>
        <p className="mt-2">
          از <code dir="ltr">data.x</code> (اطلاعات درخواست)، <code dir="ltr">case.internal.x</code> (فیلدهای داخلی) و <code dir="ltr">case.decisions.step_id</code> (آخرین اقدام هر مرحله؛ خط تیره به زیرخط تبدیل می‌شود) استفاده کنید.
          عملگرها: <code dir="ltr">== != &lt; &lt;= &gt; &gt;= &amp;&amp; || ! in</code>. مثال: <code dir="ltr">data.degree in ['phd', 'msc'] &amp;&amp; !case.internal.urgent</code>
        </p>
      </details>
    </div>
  );
}

export type { Issue };
