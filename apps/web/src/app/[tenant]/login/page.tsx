"use client";

import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { SecondFactorForm } from "@uni/shared/ui/second-factor";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { MobileOtp } from "@uni/shared/ui/mobile-otp";
import { AuthFrame } from "@/components/site/auth-frame";
import { useTenantSlug } from "@/lib/tenant";

/** Returns an MFA token when the account has 2FA, otherwise null (session cookies are set). */
async function postLogin(path: string, body: unknown): Promise<string | null> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? "ورود ناموفق بود.");
  return data?.mfaRequired ? (data.mfaToken as string) : null;
}

function LoginInner() {
  const slug = useTenantSlug();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    const next = sp.get("next");
    router.replace(next && next.startsWith(`/${slug}/`) ? next : `/${slug}/me`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const mfa = await postLogin("/api/auth/login", { identifier, password });
      if (mfa) setMfaToken(mfa);
      else await done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (mfaToken) {
    return (
      <AuthFrame title="تأیید دومرحله‌ای" subtitle="برای امنیت بیشتر، کد برنامه احراز هویت را وارد کنید.">
        <SecondFactorForm mfaToken={mfaToken} onDone={done} size="lg" />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="ورود به حساب" subtitle="با رمز عبور یا کد پیامکی وارد شوید.">
      <div role="tablist" aria-label="روش ورود" className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {([["password", "با رمز عبور"], ["otp", "با کد پیامکی"]] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`min-h-11 cursor-pointer rounded-lg text-sm font-medium transition-colors ${mode === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "password" ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="شماره موبایل یا ایمیل" required>
            {(p) => <Input {...p} className="h-11" dir="ltr" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />}
          </Field>
          <Field label="رمز عبور" required>
            {(p) => <Input {...p} className="h-11" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" loading={pending}>ورود</Button>
          <Link href={`/${slug}/forgot`} className="text-center text-sm text-primary underline">رمز عبور را فراموش کرده‌ام</Link>
        </form>
      ) : (
        <MobileOtp tenant={slug} purpose="login" submitLabel="ورود" onCode={async (mobile, code) => {
          const mfa = await postLogin("/api/auth/login-otp", { mobile, code });
          if (mfa) setMfaToken(mfa);
          else await done();
        }} />
      )}
      <p className="mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground">
        حساب ندارید؟ <Link href={`/${slug}/register`} className="text-primary underline">ثبت‌نام کنید</Link>
      </p>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
