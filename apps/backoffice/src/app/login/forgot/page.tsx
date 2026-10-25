"use client";

import { api, errorMessage } from "@uni/shared/api";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { MobileOtp } from "@uni/shared/ui/mobile-otp";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthSplit } from "@/components/auth-split";

/**
 * First login of an introduced admin (no password yet) and password recovery. Same response
 * whether or not the account exists (AUTH-11); the code only arrives if it does.
 */
export default function ForgotPage() {
  const [proof, setProof] = useState<string | null>(null);
  const [password, setPassword] = useState({ value: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.value.length < 8) return setError("رمز عبور حداقل ۸ کاراکتر باشد.");
    if (password.value !== password.confirm) return setError("تکرار رمز عبور یکسان نیست.");
    setPending(true);
    setError(null);
    try {
      await api("/v1/auth/password/reset", { method: "POST", public: true, body: { proof, newPassword: password.value } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthSplit
      title="تعیین رمز عبور"
      subtitle={done ? "رمز عبور ذخیره شد." : proof ? "رمز عبور جدید را تعیین کنید." : "برای اولین ورود یا بازیابی رمز، شماره موبایل ثبت‌شده را وارد کنید."}
    >
      {done ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-3 text-sm text-success">
            <CheckCircle2 aria-hidden className="size-5" />
            رمز عبور ذخیره شد و نشست‌های قبلی بسته شد.
          </p>
          <Link href="/login" className="flex min-h-11 items-center justify-center rounded-md bg-primary font-medium text-on-primary">
            ورود به پنل
          </Link>
        </div>
      ) : proof ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="رمز عبور جدید" required hint="حداقل ۸ کاراکتر">
            {(p) => <Input {...p} className="h-11" type="password" dir="ltr" autoComplete="new-password" value={password.value} onChange={(e) => setPassword({ ...password, value: e.target.value })} />}
          </Field>
          <Field label="تکرار رمز عبور" required>
            {(p) => <Input {...p} className="h-11" type="password" dir="ltr" autoComplete="new-password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} />}
          </Field>
          {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" loading={pending}>ذخیره رمز عبور</Button>
        </form>
      ) : (
        <MobileOtp
          purpose="reset_password"
          submitLabel="ادامه"
          onCode={async (mobile, code) => {
            const r = await api<{ proof: string }>("/v1/auth/otp/verify", { method: "POST", public: true, body: { mobile, purpose: "reset_password", code } });
            setProof(r.proof);
          }}
        />
      )}
      {!done && (
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">بازگشت به ورود</Link>
        </p>
      )}
    </AuthSplit>
  );
}
