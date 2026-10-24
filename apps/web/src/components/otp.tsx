"use client";

import { api, ApiError, errorMessage } from "@uni/shared/api";
import { toFaDigits } from "@uni/shared/format";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Purpose = "login" | "register" | "reset_password" | "verify_mobile";

const MOBILE_RE = /^(\+98|0098|98|0)?9\d{9}$/;
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/**
 * Mobile + one-time code. The code field uses autocomplete="one-time-code" so the OS can fill it
 * from the SMS, and paste is allowed (accessible authentication).
 */
export function MobileOtp({
  tenant,
  purpose,
  submitLabel,
  onCode,
  initialMobile = "",
}: {
  tenant: string;
  purpose: Purpose;
  submitLabel: string;
  onCode: (mobile: string, code: string) => Promise<void>;
  initialMobile?: string;
}) {
  const [mobile, setMobile] = useState(initialMobile);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"mobile" | "code">("mobile");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const send = async () => {
    const m = toAscii(mobile).replace(/[\s-]/g, "");
    if (!MOBILE_RE.test(m)) {
      setError("شماره موبایل معتبر نیست؛ مثلاً ۰۹۱۲۱۲۳۴۵۶۷");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const r = await api<{ resendAfterSec: number }>("/v1/auth/otp/request", { method: "POST", tenant, public: true, body: { mobile: m, purpose } });
      setPhase("code");
      setResendIn(r.resendAfterSec);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      if (e instanceof ApiError && typeof e.details?.retryAfterSec === "number") {
        setPhase("code");
        setResendIn(e.details.retryAfterSec);
      }
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (phase === "mobile") return send();
    const c = toAscii(code).trim();
    if (!/^\d{6}$/.test(c)) {
      setError("کد ۶ رقمی را وارد کنید.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCode(toAscii(mobile).replace(/[\s-]/g, ""), c);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
      <Field label="شماره موبایل" required hint={phase === "mobile" ? "کد تأیید به این شماره پیامک می‌شود." : undefined}>
        {(p) => (
          <Input {...p} className="h-11" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" readOnly={phase === "code"} value={mobile} onChange={(e) => setMobile(e.target.value)} />
        )}
      </Field>
      {phase === "code" && (
        <>
          <Field label="کد تأیید" required hint="کد ۶ رقمی پیامک‌شده؛ تا ۲ دقیقه و نیم معتبر است.">
            {(p) => (
              <Input
                {...p}
                ref={codeRef}
                className="h-11 text-center text-lg tracking-[0.5em]"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="cursor-pointer text-primary underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline" disabled={resendIn > 0 || pending} onClick={send}>
              {resendIn > 0 ? `ارسال دوباره تا ${toFaDigits(String(resendIn))} ثانیه دیگر` : "ارسال دوباره کد"}
            </button>
            <span aria-hidden className="text-muted-foreground">·</span>
            <button
              type="button"
              className="cursor-pointer text-primary underline"
              onClick={() => {
                setPhase("mobile");
                setCode("");
                setError(null);
              }}
            >
              تغییر شماره
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={pending}>
        {phase === "mobile" ? "دریافت کد تأیید" : submitLabel}
      </Button>
    </form>
  );
}
