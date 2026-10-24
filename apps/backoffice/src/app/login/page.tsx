"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { Logo } from "@uni/shared/ui/logo";
import { SecondFactorForm } from "@uni/shared/ui/second-factor";
import { ShieldCheck } from "lucide-react";

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
    <main id="main" className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <Logo className="size-10" />
            <div className="leading-tight">
              <p className="font-bold">پنل مدیریت</p>
              <p className="text-xs text-muted-foreground">سامانه خدمات دانشگاهی</p>
            </div>
          </div>
          <h1 className="text-2xl font-black">ورود به حساب</h1>
          <p className="mt-1.5 mb-8 text-sm text-muted-foreground">مدیران سامانه، مدیران و کارشناسان دانشگاه‌ها</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
      <aside aria-hidden className="hero-band relative isolate hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 -z-10">
          <span className="aurora aurora-1 -top-20 -end-10 size-[30rem]" />
          <span className="aurora aurora-2 bottom-[-15%] start-[10%] size-[26rem]" />
          <span className="aurora aurora-3 top-[30%] start-[-10%] size-80" />
          <div className="grid-lines absolute inset-0" />
        </div>
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-white/85 backdrop-blur">
          <ShieldCheck className="size-4 text-gold-bright" />
          دسترسی امن و ردیابی‌شده
        </p>
        <div>
          <h2 className="text-4xl leading-tight font-black">
            همه فرایندهای دانشگاه،
            <br />
            <span className="text-gold-gradient">در یک پنل.</span>
          </h2>
          <p className="mt-4 max-w-md leading-8 text-white/70">عضویت‌ها، ساختار سازمانی، نقش‌ها و ممیزی را از یک جا مدیریت کنید؛ هر دانشگاه با قواعد خودش.</p>
        </div>
        <ul className="grid grid-cols-3 gap-3 text-sm">
          {["جداسازی کامل داده", "ممیزی غیرقابل‌تغییر", "ورود دومرحله‌ای"].map((f) => (
            <li key={f} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-white/80 backdrop-blur">{f}</li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
