"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./button";
import { Field, Input } from "./field";

/** Second login step for accounts with TOTP (AUTH-12). Accepts a 6-digit code or a recovery code. */
export function SecondFactorForm({ mfaToken, onDone, size = "md" }: { mfaToken: string; onDone: () => Promise<void> | void; size?: "md" | "lg" }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth/login-2fa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mfaToken, code }) });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "کد نادرست است.");
      return;
    }
    await onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted-foreground">
        {recovery ? "یکی از کدهای بازیابی را که هنگام فعال‌سازی ذخیره کرده‌اید وارد کنید." : "کد ۶ رقمی برنامه احراز هویت (مثل Google Authenticator) را وارد کنید."}
      </p>
      <Field label={recovery ? "کد بازیابی" : "کد تأیید دومرحله‌ای"} required>
        {(p) => (
          <Input
            {...p}
            className={`${size === "lg" ? "h-11" : ""} text-center text-lg tracking-[0.3em]`}
            dir="ltr"
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            maxLength={recovery ? 12 : 6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size={size} loading={pending}>
        تأیید و ورود
      </Button>
      <button type="button" onClick={() => { setRecovery((r) => !r); setCode(""); setError(null); }} className="cursor-pointer text-sm text-primary underline">
        {recovery ? "استفاده از کد برنامه" : "دسترسی به برنامه ندارم؛ کد بازیابی"}
      </button>
    </form>
  );
}
