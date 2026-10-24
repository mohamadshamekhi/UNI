"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@uni/shared/api";
import { MEMBERSHIP_STATUS } from "@uni/shared/labels";
import type { MyMembership } from "@uni/shared/types";
import { Badge } from "@uni/shared/ui/badge";
import { Logo } from "@uni/shared/ui/logo";
import { EmptyState, Loading } from "@uni/shared/ui/states";
import { ThemeToggle } from "@uni/shared/ui/theme";
import { ArrowLeft, KeyRound, Landmark, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/lib/hooks";

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign("/login");
}

/** Workspace picker: platform administration and/or the universities the user belongs to. */
export default function Home() {
  const me = useMe();
  const memberships = useQuery({ queryKey: ["my-memberships"], queryFn: () => api<MyMembership[]>("/v1/me/memberships") });

  return (
    <div className="min-h-screen bg-background">
      <section className="hero-band relative isolate overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10">
          <span className="aurora aurora-1 -top-32 -end-10 size-[28rem]" />
          <span className="aurora aurora-3 -bottom-32 start-0 size-72" />
          <div className="grid-lines absolute inset-0" />
        </div>
        <header className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Logo className="size-9" />
          <span className="font-bold">پنل مدیریت</span>
          <span className="ms-auto" />
          <ThemeToggle className="text-white hover:bg-white/10" />
          <Link href="/account" aria-label="امنیت حساب" className="flex size-10 items-center justify-center rounded-full hover:bg-white/10">
            <KeyRound aria-hidden className="size-[18px]" />
          </Link>
          <button type="button" onClick={logout} aria-label="خروج" className="flex size-10 cursor-pointer items-center justify-center rounded-full hover:bg-white/10">
            <LogOut aria-hidden className="size-[18px]" />
          </button>
        </header>
        <div className="mx-auto max-w-5xl px-4 pt-8 pb-24 sm:px-6">
          <p className="text-sm text-white/70">{me.data ? `سلام ${me.data.fullName}،` : "…"}</p>
          <h1 className="mt-1 text-3xl font-black sm:text-4xl">
            کدام بخش را <span className="text-gold-gradient">مدیریت می‌کنید؟</span>
          </h1>
        </div>
      </section>

      <main id="main" className="relative mx-auto -mt-14 max-w-5xl px-4 pb-16 sm:px-6">
        {me.data?.isPlatformAdmin && (
          <Link
            href="/platform/tenants"
            className="group mb-8 flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_20px_50px_-24px_rgb(2_6_23/0.35)] transition hover:-translate-y-0.5"
          >
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#e0b44c] to-[#9a6b00] text-white shadow-lg">
              <ShieldCheck aria-hidden className="size-7" strokeWidth={1.6} />
            </span>
            <span className="flex-1">
              <span className="block text-lg font-bold">مدیریت سامانه</span>
              <span className="block text-sm text-muted-foreground">سازمان‌ها، ماژول‌ها، مدیران دانشگاه‌ها و ممیزی سراسری</span>
            </span>
            <ArrowLeft aria-hidden className="size-5 text-muted-foreground transition-transform group-hover:-translate-x-1" />
          </Link>
        )}

        <h2 className="mb-4 text-sm font-semibold text-muted-foreground">دانشگاه‌های من</h2>
        {memberships.isPending ? (
          <Loading rows={3} />
        ) : !memberships.data?.length ? (
          <EmptyState icon={Landmark} title="عضویتی در دانشگاه‌ها ندارید" description={me.data?.isPlatformAdmin ? "برای مدیریت یک دانشگاه، از «مدیریت سامانه» خودتان را به‌عنوان مدیر آن معرفی کنید." : "برای دسترسی به پنل یک دانشگاه با مدیر آن دانشگاه تماس بگیرید."} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {memberships.data.map((m) => {
              const st = MEMBERSHIP_STATUS[m.status];
              const body = (
                <>
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2f6bff] to-[#1e3a8a] text-white">
                    <Landmark aria-hidden className="size-6" strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{m.tenantNameFa}</span>
                    <span className="mt-1 block">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </span>
                  </span>
                  {m.status === "active" && <ArrowLeft aria-hidden className="size-5 text-muted-foreground transition-transform group-hover:-translate-x-1" />}
                </>
              );
              const cls = "group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-20px_rgb(15_23_42/0.18)]";
              return (
                <li key={m.id}>
                  {m.status === "active" ? (
                    <Link href={`/t/${m.tenantSlug}`} className={`${cls} transition hover:-translate-y-0.5 hover:border-primary/40`}>
                      {body}
                    </Link>
                  ) : (
                    <div className={`${cls} opacity-70`}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
