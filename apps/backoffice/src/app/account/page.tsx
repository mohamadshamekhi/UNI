"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtNum } from "@uni/shared/format";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog } from "@uni/shared/ui/dialog";
import { Field, Input } from "@uni/shared/ui/field";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { ArrowRight, Copy, ShieldCheck } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

/** Account security: TOTP enrolment (AUTH-12) and active sessions. */
export default function AccountPage() {
  const status = useQuery({ queryKey: ["mfa"], queryFn: () => api<MfaStatus>("/v1/auth/2fa") });
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        بازگشت
      </Link>
      <PageHeader title="امنیت حساب" description="ورود دومرحله‌ای و نشست‌های فعال" />
      <QueryView query={status}>{(s) => <TwoFactorCard status={s} />}</QueryView>
      <div className="mt-4">
        <Sessions />
      </div>
    </main>
  );
}

function TwoFactorCard({ status }: { status: MfaStatus }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const start = async () => {
    setError(null);
    setPending(true);
    try {
      const r = await api<{ secret: string; otpauthUri: string }>("/v1/auth/2fa/setup", { method: "POST" });
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 200 }) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await api<{ recoveryCodes: string[] }>("/v1/auth/2fa/enable", { method: "POST", body: { code } });
      setCodes(r.recoveryCodes);
      setSetup(null);
      qc.invalidateQueries({ queryKey: ["mfa"] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (codes) {
    return (
      <Card title="کدهای بازیابی">
        <p className="text-sm">ورود دومرحله‌ای فعال شد. این کدها را در جای امنی نگه دارید؛ اگر به گوشی دسترسی نداشتید، هر کد یک بار برای ورود کار می‌کند. این کدها دیگر نمایش داده نمی‌شوند.</p>
        <ul className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-muted p-4 font-mono text-sm" dir="ltr">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(codes.join("\n")); toast("کدها کپی شد."); }}>
            <Copy aria-hidden className="size-4" />
            کپی کدها
          </Button>
          <Button onClick={() => setCodes(null)}>ذخیره کردم</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="ورود دومرحله‌ای" actions={status.enabled ? <Badge tone="success">فعال</Badge> : <Badge tone="warning">غیرفعال</Badge>}>
      {status.enabled ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-5 text-success" />
            از {fmtDateTime(status.enabledAt)} فعال است. کدهای بازیابی باقی‌مانده: {fmtNum(status.recoveryCodesLeft)}
          </p>
          <Button variant="secondary" className="self-start" onClick={() => setDisabling(true)}>
            غیرفعال کردن
          </Button>
        </div>
      ) : setup ? (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <p className="text-sm">با برنامه احراز هویت (Google Authenticator، Microsoft Authenticator یا مشابه) این کد QR را اسکن کنید، سپس کد ۶ رقمی را وارد کنید.</p>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="کد QR برای افزودن حساب به برنامه احراز هویت" className="size-44 rounded-md border border-border bg-white p-1" />
            <div className="min-w-0 text-sm">
              <p className="text-muted-foreground">یا این کلید را دستی وارد کنید:</p>
              <code dir="ltr" className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">{setup.secret}</code>
            </div>
          </div>
          <Field label="کد ۶ رقمی" required>
            {(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-40 text-center tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>فعال‌سازی</Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>انصراف</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">برای حساب‌های مدیریتی توصیه جدی می‌شود. پس از فعال‌سازی، علاوه بر رمز یا کد پیامکی، کد برنامه احراز هویت هم لازم است.</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button className="self-start" loading={pending} onClick={start}>
            <ShieldCheck aria-hidden className="size-4" />
            فعال‌سازی ورود دومرحله‌ای
          </Button>
        </div>
      )}
      <DisableDialog open={disabling} onClose={() => setDisabling(false)} onDone={() => { qc.invalidateQueries({ queryKey: ["mfa"] }); toast("ورود دومرحله‌ای غیرفعال شد."); }} />
    </Card>
  );
}

function DisableDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="غیرفعال کردن ورود دومرحله‌ای"
      submitLabel="غیرفعال کن"
      danger
      onSubmit={async () => {
        await api("/v1/auth/2fa/disable", { method: "POST", body: { password, code } });
        setPassword("");
        setCode("");
        onDone();
      }}
    >
      <Field label="رمز عبور" required>{(p) => <Input {...p} type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Field label="کد برنامه یا کد بازیابی" required>{(p) => <Input {...p} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ id: string; userAgent: string | null; ip: string | null; lastUsedAt: string; current: boolean }[]>("/v1/auth/sessions"),
  });
  return (
    <Card
      title="نشست‌های فعال"
      actions={
        <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { await api("/v1/auth/logout-all", { method: "POST" }); window.location.assign("/login"); }}>
          خروج از همه دستگاه‌ها
        </Button>
      }
    >
      <QueryView query={q}>
        {(rows) => (
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="ltr">{s.userAgent ?? "—"}</span>
                <span className="text-xs tabular text-muted-foreground">{fmtDateTime(s.lastUsedAt)}</span>
                {s.current ? (
                  <Badge tone="info">همین دستگاه</Badge>
                ) : (
                  <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { await api(`/v1/auth/sessions/${s.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["sessions"] }); }}>
                    خروج
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Card>
  );
}
