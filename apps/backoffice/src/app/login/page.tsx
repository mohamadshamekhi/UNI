"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    const next = params.get("next");
    // only same-site relative paths, never an open redirect
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

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
      <Button type="submit" loading={pending} className="w-full">
        ورود
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-bold">ورود به پنل مدیریت</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">مدیران سامانه و دانشگاه‌ها</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
