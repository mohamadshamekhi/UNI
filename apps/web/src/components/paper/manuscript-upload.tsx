"use client";

import { FileUp, ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtBytes } from "@uni/shared/format";

/** Manuscript upload (PDF/DOCX); double-blind tracks get a reminder to remove identifying text. */
export function ManuscriptUpload({ tenant, value, onChange, blind, label = "فایل مقاله" }: { tenant: string; value: { id: string; name: string; size: number } | null; onChange: (v: { id: string; name: string; size: number } | null) => void; blind: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (f: File) => {
    setError(null);
    if (f.size > 30 * 1024 * 1024) return setError("حجم فایل باید کمتر از ۳۰ مگابایت باشد.");
    const fd = new FormData();
    fd.set("purpose", "paper_manuscript");
    fd.set("file", f);
    setPending(true);
    try {
      const row = await api<{ id: string }>("/v1/files", { method: "POST", tenant, body: fd });
      onChange({ id: row.id, name: f.name, size: f.size });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">
        {label} <span className="text-danger" aria-hidden>*</span>
      </span>
      <label htmlFor="manuscript" className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-4 py-4 text-center text-sm hover:border-primary">
        <FileUp aria-hidden className="size-6 text-primary" />
        {pending ? "در حال بارگذاری…" : value ? <span dir="auto" className="font-medium">{value.name} · {fmtBytes(value.size)}</span> : "انتخاب فایل PDF یا Word (حداکثر ۳۰ مگابایت)"}
      </label>
      <input ref={input} id="manuscript" type="file" className="sr-only" accept="application/pdf,.docx" disabled={pending} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {blind && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-bg px-3 py-2 text-xs leading-6 text-warning">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          داوری این روند دوسوکور است: نام نویسندگان، سپاسگزاری و ارجاع صریح به کارهای خودتان را از متن حذف کنید. فراداده فایل به‌طور خودکار پاک می‌شود.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
