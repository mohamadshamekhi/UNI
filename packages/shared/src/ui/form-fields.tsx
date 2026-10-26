"use client";

import { Lock, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { JalaliDateInput } from "./jalali-date-input";
import { Checkbox, Field, Input, Select, Textarea } from "./field";
import type { FormFieldDef } from "../types";

export type FormValues = Record<string, unknown>;

/** Renders a request or step form from its definition (WF-10); internal fields are marked as staff-only. */
export function FormFields({
  fields,
  values,
  onChange,
  errors,
  tenant,
  showInternal = true,
}: {
  showInternal?: boolean;
  fields: FormFieldDef[];
  values: FormValues;
  onChange: (v: FormValues) => void;
  errors: Record<string, string>;
  tenant: string;
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const label = f.visibility === "internal" && showInternal ? `${f.label} (داخلی)` : f.label;
        const err = errors[f.key] ? FIELD_ERROR[errors[f.key]!] ?? "مقدار نامعتبر است." : null;
        const wide = f.type === "textarea" || f.type === "file";
        if (f.type === "checkbox") {
          return (
            <div key={f.key} className="flex items-center sm:col-span-2">
              <Checkbox label={label} checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
            </div>
          );
        }
        return (
          <Field key={f.key} label={label} required={f.required} error={err} hint={f.visibility === "internal" && showInternal ? "به متقاضی نمایش داده نمی‌شود." : undefined} className={wide ? "sm:col-span-2" : undefined}>
            {(p) => {
              const v = values[f.key];
              switch (f.type) {
                case "textarea":
                  return <Textarea {...p} value={(v as string) ?? ""} maxLength={4000} onChange={(e) => set(f.key, e.target.value)} />;
                case "number":
                  return <Input {...p} type="number" dir="ltr" value={v === undefined ? "" : String(v)} onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />;
                case "select":
                  return (
                    <Select {...p} value={(v as string) ?? ""} onChange={(e) => set(f.key, e.target.value || undefined)}>
                      <option value="">انتخاب کنید</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  );
                case "date":
                  return <JalaliDateInput {...p} value={(v as string) ?? ""} onChange={(iso) => set(f.key, iso || undefined)} />;
                case "file":
                  return <FileField {...p} tenant={tenant} value={(v as string[]) ?? []} onChange={(ids) => set(f.key, ids.length ? ids : undefined)} />;
                default:
                  return <Input {...p} value={(v as string) ?? ""} maxLength={500} onChange={(e) => set(f.key, e.target.value)} />;
              }
            }}
          </Field>
        );
      })}
    </div>
  );
}

/** Names of files uploaded in this session, so re-rendered forms keep showing them. */
const fileNames = new Map<string, string>();

const FIELD_ERROR: Record<string, string> = { required: "این فیلد الزامی است.", invalid: "مقدار نامعتبر است.", unknown: "فیلد ناشناخته" };

function FileField({ id, tenant, value, onChange }: { id: string; tenant: string; value: string[]; onChange: (ids: string[]) => void }) {
  const knownNames = Object.fromEntries(value.map((v) => [v, fileNames.get(v) ?? v.slice(0, 8)]));
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<Record<string, string>>(knownNames);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setError(null);
    if (file.size > 20 * 1024 * 1024) return setError("حجم فایل باید کمتر از ۲۰ مگابایت باشد.");
    const fd = new FormData();
    fd.set("purpose", "case_attachment");
    fd.set("file", file);
    setPending(true);
    try {
      const row = await api<{ id: string }>("/v1/files", { method: "POST", tenant, body: fd });
      setNames((n) => ({ ...n, [row.id]: file.name }));
      fileNames.set(row.id, file.name);
      onChange([...value, row.id]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 text-sm text-muted-foreground hover:border-primary hover:text-primary">
        <Paperclip aria-hidden className="size-4" />
        {pending ? "در حال بارگذاری…" : "افزودن پیوست (PDF یا تصویر)"}
      </label>
      <input ref={input} id={id} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" disabled={pending} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((fid) => (
            <li key={fid} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs">
              <Lock aria-hidden className="size-3" />
              {names[fid] ?? fid.slice(0, 8)}
              <button type="button" aria-label="حذف پیوست" className="cursor-pointer rounded-full p-0.5 hover:bg-card" onClick={() => onChange(value.filter((x) => x !== fid))}>
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** File ids held by a form value (single id or list). */
export const fileIds = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Opens a case attachment through a fresh single-use link (preview when the type allows it). */
export async function openFile(tenant: string, id: string) {
  const win = window.open("about:blank", "_blank");
  try {
    const { url } = await api<{ url: string }>(`/v1/files/${id}/download-link`, { method: "POST", tenant, body: { inline: true } });
    if (win) {
      win.opener = null;
      win.location.href = `/api/proxy${url}`;
    } else window.location.assign(`/api/proxy${url}`);
  } catch (e) {
    win?.close();
    throw e;
  }
}
