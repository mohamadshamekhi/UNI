"use client";

import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { MobileOtp } from "@/components/otp";
import { useTenantSlug } from "@/lib/tenant";

async function postLogin(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message ?? "ورود ناموفق بود.");
  }
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
      await postLogin("/api/auth/login", { identifier, password });
      await done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-xl font-bold">ورود به حساب</h1>
      <div role="tablist" aria-label="روش ورود" className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {([["password", "با رمز عبور"], ["otp", "با کد پیامکی"]] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`min-h-11 cursor-pointer rounded-md text-sm font-medium ${mode === k ? "bg-card shadow-sm" : "text-muted-foreground"}`}
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
          await postLogin("/api/auth/login-otp", { mobile, code });
          await done();
        }} />
      )}
      <p className="mt-8 text-center text-sm text-muted-foreground">
        حساب ندارید؟ <Link href={`/${slug}/register`} className="text-primary underline">ثبت‌نام کنید</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
