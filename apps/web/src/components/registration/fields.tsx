"use client";

import { api, errorMessage } from "@uni/shared/api";
import { fmtBytes, toFaDigits } from "@uni/shared/format";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { FileText, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { PublicUnit } from "@/lib/tenant";

export type Kind = "student" | "faculty";

export interface ProfileValues {
  degree: string;
  field: string;
  entryYear: string;
  academicRank: string;
}

export const EMPTY_PROFILE: ProfileValues = { degree: "", field: "", entryYear: "", academicRank: "" };

export const DEGREES: Record<string, string> = { bsc: "کارشناسی", msc: "کارشناسی ارشد", phd: "دکتری", other: "سایر" };
export const RANKS: Record<string, string> = { instructor: "مربی", assistant: "استادیار", associate: "دانشیار", full: "استاد تمام" };

/** Faculty first, then an optional department/field under it (section 6, step 2). */
export function UnitPicker({
  units,
  facultyId,
  subUnitId,
  onChange,
  errors,
}: {
  units: PublicUnit[];
  facultyId: string;
  subUnitId: string;
  onChange: (facultyId: string, subUnitId: string) => void;
  errors?: { facultyId?: string };
}) {
  const faculty = units.find((u) => u.id === facultyId);
  const flatten = (nodes: PublicUnit[], prefix = ""): { id: string; label: string }[] =>
    nodes.flatMap((n) => [{ id: n.id, label: prefix + n.nameFa }, ...flatten(n.children, `${prefix}${n.nameFa} › `)]);
  const subs = faculty ? flatten(faculty.children) : [];
  return (
    <>
      <Field label="دانشکده" required error={errors?.facultyId}>
        {(p) => (
          <Select {...p} className="h-11" value={facultyId} onChange={(e) => onChange(e.target.value, "")}>
            <option value="" disabled>انتخاب کنید</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.nameFa}</option>
            ))}
          </Select>
        )}
      </Field>
      {subs.length > 0 && (
        <Field label="گروه / رشته" hint="اگر گروه شما در فهرست نیست، خالی بگذارید.">
          {(p) => (
            <Select {...p} className="h-11" value={subUnitId} onChange={(e) => onChange(facultyId, e.target.value)}>
              <option value="">— بدون انتخاب —</option>
              {subs.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </>
  );
}

export function ProfileFields({ kind, value, onChange }: { kind: Kind; value: ProfileValues; onChange: (v: ProfileValues) => void }) {
  const set = (k: keyof ProfileValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      {kind === "student" ? (
        <Field label="مقطع تحصیلی" required>
          {(p) => (
            <Select {...p} className="h-11" value={value.degree} onChange={set("degree")}>
              <option value="" disabled>انتخاب کنید</option>
              {Object.entries(DEGREES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="مرتبه علمی" required>
          {(p) => (
            <Select {...p} className="h-11" value={value.academicRank} onChange={set("academicRank")}>
              <option value="" disabled>انتخاب کنید</option>
              {Object.entries(RANKS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="رشته / گرایش">{(p) => <Input {...p} className="h-11" value={value.field} onChange={set("field")} />}</Field>
      {kind === "student" && (
        <Field label="سال ورود" hint="مثلاً ۱۴۰۳">
          {(p) => <Input {...p} className="h-11" inputMode="numeric" dir="ltr" maxLength={4} value={value.entryYear} onChange={set("entryYear")} />}
        </Field>
      )}
    </>
  );
}

export const profilePayload = (kind: Kind, v: ProfileValues) =>
  kind === "student" ? { degree: v.degree, field: v.field || undefined, entryYear: v.entryYear || undefined } : { academicRank: v.academicRank, field: v.field || undefined };

export interface Uploaded {
  id: string;
  originalName: string;
  sizeBytes: number;
}

/**
 * Document upload (FIL-03): JPG/PNG/PDF up to 5 MB. Before an account exists the upload is
 * authorised by the mobile proof from the OTP step.
 */
export function DocumentUpload({
  tenant,
  proof,
  files,
  onChange,
  label,
  error,
}: {
  tenant: string;
  proof?: string;
  files: Uploaded[];
  onChange: (f: Uploaded[]) => void;
  label: string;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("حجم فایل باید کمتر از ۵ مگابایت باشد.");
      return;
    }
    const fd = new FormData();
    fd.set("purpose", "membership_document");
    fd.set("file", file);
    setPending(true);
    try {
      const row = await api<Uploaded>("/v1/files", { method: "POST", tenant, body: fd, public: true, headers: proof ? { "x-mobile-proof": proof } : undefined });
      onChange([...files, row]);
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  const message = uploadError ?? error;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">
        {label} <span className="text-danger" aria-hidden>*</span>
      </span>
      <p className="text-xs text-muted-foreground">فرمت JPG، PNG یا PDF، حداکثر ۵ مگابایت. تصویر باید خوانا باشد.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" id="doc-upload" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button size="lg" variant="secondary" loading={pending} onClick={() => input.current?.click()} aria-describedby={message ? "doc-err" : undefined}>
        <Upload aria-hidden className="size-5" />
        انتخاب فایل
      </Button>
      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
              <FileText aria-hidden className="size-5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{f.originalName}</span>
                <span className="block text-xs text-muted-foreground">{fmtBytes(f.sizeBytes)}</span>
              </span>
              <button type="button" aria-label={`حذف ${f.originalName}`} onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="flex size-11 cursor-pointer items-center justify-center rounded-md text-danger hover:bg-danger-bg">
                <Trash2 aria-hidden className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p id="doc-err" role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

/** Step indicator (forms rule: progress for multi-step flows). */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex gap-1.5" aria-label={`مرحله ${toFaDigits(String(current + 1))} از ${toFaDigits(String(steps.length))}`}>
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined} className="flex flex-1 flex-col gap-1.5">
          <span className={`h-1.5 rounded-full ${i <= current ? "bg-primary" : "bg-muted"}`} />
          <span className={`hidden text-xs sm:block ${i === current ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
