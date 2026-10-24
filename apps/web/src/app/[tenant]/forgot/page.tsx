"use client";

import { api, errorMessage } from "@uni/shared/api";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MobileOtp } from "@/components/otp";
import { AuthFrame } from "@/components/site/auth-frame";
import { useTenantSlug } from "@/lib/tenant";

/** AUTH-11: same response whether or not the account exists; the code only arrives if it does. */
export default function ForgotPage() {
  const slug = useTenantSlug();
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
    <AuthFrame title="بازیابی رمز عبور" subtitle={done ? undefined : proof ? "رمز عبور جدید را تعیین کنید." : "اگر برای این شماره حساب وجود داشته باشد، کد تأیید پیامک می‌شود."}>
      {done ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-3 text-sm text-success">
            <CheckCircle2 aria-hidden className="size-5" />
            رمز عبور تغییر کرد و همه نشست‌های قبلی بسته شد.
          </p>
          <Link href={`/${slug}/login`} className="flex min-h-11 items-center justify-center rounded-md bg-primary font-medium text-on-primary">ورود</Link>
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
        <>
          <MobileOtp tenant={slug} purpose="reset_password" submitLabel="ادامه" onCode={async (mobile, code) => {
            const r = await api<{ proof: string }>("/v1/auth/otp/verify", { method: "POST", public: true, body: { mobile, purpose: "reset_password", code } });
            setProof(r.proof);
          }} />
        </>
      )}
    </AuthFrame>
  );
}
