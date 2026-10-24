"use client";

import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@uni/shared/api";
import { fmtNum } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Dialog } from "@uni/shared/ui/dialog";
import { Table, Td, Th } from "@uni/shared/ui/layout";
import { useToast } from "@uni/shared/ui/toast";
import { Download, FileSpreadsheet } from "lucide-react";
import { useRef, useState } from "react";
import { useSlug } from "@/lib/hooks";

interface ImportResult {
  dryRun: boolean;
  total: number;
  ready: number;
  created: number;
  failed: number;
  rows: { row: number; kind?: string; fullName?: string; mobile?: string; unit?: string; memberNo?: string; status: "ready" | "error" | "created"; errors: string[] }[];
}

const KIND_FA: Record<string, string> = { student: "دانشجو", faculty: "استاد", staff: "کارمند" };

/** CSV template with a BOM so Excel opens Persian text correctly. */
function downloadTemplate() {
  const csv = "﻿نوع,نام و نام خانوادگی,موبایل,ایمیل,واحد,شماره\nاستاد,مریم احمدی,09121234567,m.ahmadi@example.ac.ir,دانشکده فنی,P-1024\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "member-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** AUTH-16: upload → validation preview → import of valid rows. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const run = async (f: File, dryRun: boolean) => {
    const fd = new FormData();
    fd.set("file", f);
    setPending(true);
    setError(null);
    try {
      const r = await api<ImportResult>("/v1/admin/memberships/import", { method: "POST", tenant: slug, body: fd, query: { dryRun } });
      setResult(r);
      if (!dryRun) {
        qc.invalidateQueries({ queryKey: ["memberships", slug] });
        toast(`${fmtNum(r.created)} عضو اضافه و دعوت‌نامه پیامک شد.`);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const done = result && !result.dryRun;
  return (
    <Dialog
      wide
      open={open}
      onClose={close}
      title="ورود گروهی اعضا"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            {done ? "بستن" : "انصراف"}
          </Button>
          {result?.dryRun && result.ready > 0 && (
            <Button loading={pending} onClick={() => file && run(file, false)}>
              افزودن {fmtNum(result.ready)} عضو
            </Button>
          )}
        </>
      }
    >
      {!result ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            فایل اکسل (xlsx) یا CSV با ستون‌های «نوع، نام و نام خانوادگی، موبایل، ایمیل، واحد، شماره». ستون واحد می‌تواند کد یا نام دقیق واحد باشد. حداکثر ۱۰۰۰ ردیف.
          </p>
          <Button variant="ghost" className="self-start" onClick={downloadTemplate}>
            <Download aria-hidden className="size-4" />
            دریافت فایل نمونه
          </Button>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            id="import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                run(f, true);
              }
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={pending}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 transition-colors hover:border-primary disabled:opacity-60"
          >
            <FileSpreadsheet aria-hidden className="size-8 text-primary" />
            <span className="font-medium">{pending ? "در حال بررسی فایل…" : "انتخاب فایل"}</span>
            <span className="text-xs text-muted-foreground">پیش از افزودن، همه ردیف‌ها بررسی و پیش‌نمایش می‌شوند.</span>
          </button>
          {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div role="status" className="flex flex-wrap gap-2 text-sm">
            <Badge>{fmtNum(result.total)} ردیف</Badge>
            {result.dryRun ? <Badge tone="success">{fmtNum(result.ready)} آماده</Badge> : <Badge tone="success">{fmtNum(result.created)} افزوده شد</Badge>}
            {result.failed > 0 && <Badge tone="danger">{fmtNum(result.failed)} دارای خطا</Badge>}
          </div>
          {result.dryRun && result.failed > 0 && <p className="text-sm text-muted-foreground">ردیف‌های دارای خطا وارد نمی‌شوند؛ می‌توانید فایل را اصلاح و دوباره بارگذاری کنید.</p>}
          <Table caption="نتیجه بررسی فایل">
            <thead>
              <tr>
                <Th>ردیف</Th>
                <Th>نام</Th>
                <Th>نوع</Th>
                <Th>موبایل</Th>
                <Th>واحد</Th>
                <Th>وضعیت</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.row} className={r.status === "error" ? "bg-danger-bg/40" : ""}>
                  <Td className="tabular">{fmtNum(r.row)}</Td>
                  <Td>{r.fullName ?? "—"}</Td>
                  <Td>{r.kind ? KIND_FA[r.kind] : "—"}</Td>
                  <Td className="tabular" >
                    <span dir="ltr">{r.mobile ?? "—"}</span>
                  </Td>
                  <Td>{r.unit ?? "—"}</Td>
                  <Td>
                    {r.status === "error" ? (
                      <ul className="text-xs text-danger">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ) : (
                      <Badge tone="success">{r.status === "created" ? "افزوده شد" : "آماده"}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!done && (
            <Button variant="ghost" className="self-start" onClick={reset}>
              انتخاب فایل دیگر
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
