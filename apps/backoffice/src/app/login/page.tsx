"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { SecondFactorForm } from "@uni/shared/ui/second-factor";
import Link from "next/link";
import { AuthSplit } from "@/components/auth-split";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const goNext = () => {
    const next = params.get("next");
    // only same-site relative paths, never an open redirect
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "ورود ناموفق بود.");
      return;
    }
    const data = await res.json().catch(() => null);
    if (data?.mfaRequired) {
      setMfaToken(data.mfaToken);
      return;
    }
    goNext();
  };

  if (mfaToken) return <SecondFactorForm mfaToken={mfaToken} onDone={goNext} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="شماره موبایل یا ایمیل" required>
        {(p) => <Input {...p} dir="ltr" autoComplete="username" inputMode="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />}
      </Field>
      <Field label="رمز عبور" required>
        {(p) => <Input {...p} type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending} className="h-11 w-full">
        ورود
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthSplit title="ورود به حساب" subtitle="مدیران سامانه، مدیران و کارشناسان دانشگاه‌ها">
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        اولین ورود یا رمز را فراموش کرده‌اید؟{" "}
        <Link href="/login/forgot" className="font-medium text-primary underline-offset-4 hover:underline">
          تعیین رمز با کد پیامکی
        </Link>
      </p>
    </AuthSplit>
  );
}
