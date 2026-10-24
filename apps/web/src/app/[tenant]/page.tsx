"use client";

import { GraduationCap, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { usePublicTenant, useSession, useTenantSlug } from "@/lib/tenant";

export default function TenantHome() {
  const slug = useTenantSlug();
  const tenant = usePublicTenant(slug);
  const session = useSession();
  const name = tenant.data?.branding.displayName || tenant.data?.nameFa;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <GraduationCap aria-hidden className="mb-3 size-10 text-primary" />
        <h1 className="text-2xl font-bold text-balance">خدمات آموزشی و پژوهشی {name}</h1>
        <p className="mt-2 text-muted-foreground">برای استفاده از خدمات، ابتدا عضویت شما باید توسط کارشناس دانشگاه تأیید شود.</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        {session.data ? (
          <Link href={`/${slug}/me`} className="flex min-h-14 items-center gap-3 rounded-lg bg-primary px-5 py-4 font-medium text-on-primary hover:bg-primary-hover">
            <LogIn aria-hidden className="size-5" />
            مشاهده وضعیت عضویت
          </Link>
        ) : (
          <>
            <Link href={`/${slug}/register`} className="flex min-h-14 items-center gap-3 rounded-lg bg-primary px-5 py-4 font-medium text-on-primary hover:bg-primary-hover">
              <UserPlus aria-hidden className="size-5" />
              ثبت‌نام دانشجو یا استاد
            </Link>
            <Link href={`/${slug}/login`} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 font-medium hover:border-primary">
              <LogIn aria-hidden className="size-5" />
              ورود به حساب
            </Link>
          </>
        )}
      </div>
      <section aria-labelledby="steps" className="rounded-lg border border-border bg-card p-5">
        <h2 id="steps" className="mb-3 font-semibold">مراحل ثبت‌نام</h2>
        <ol className="list-inside list-decimal space-y-1.5 text-sm text-muted-foreground">
          <li>انتخاب دانشکده و گروه</li>
          <li>وارد کردن اطلاعات و تأیید شماره موبایل با کد پیامکی</li>
          <li>بارگذاری تصویر کارت دانشجویی یا حکم کارگزینی</li>
          <li>بررسی مدارک توسط کارشناس و اطلاع‌رسانی نتیجه با پیامک</li>
        </ol>
      </section>
    </div>
  );
}
