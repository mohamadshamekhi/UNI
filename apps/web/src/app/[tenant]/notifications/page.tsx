"use client";

import { InboxList, NotificationPreferences } from "@uni/shared/ui/notifications";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

const portalLink = (link: string | null) => (link && !link.startsWith("/t/") ? link : null);

export default function NotificationsPage() {
  const slug = useTenantSlug();
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <p className="text-sm text-white/70">حساب کاربری</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">اعلان‌ها</h1>
        <p className="mt-2 max-w-xl leading-7 text-white/75">نتیجه بررسی‌ها، درخواست‌های اصلاح و تغییرات پرونده‌های شما.</p>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <InboxList tenant={slug} resolve={portalLink} />
        <section aria-labelledby="channels" className="self-start rounded-3xl border border-border bg-card p-5">
          <h2 id="channels" className="mb-2 font-bold">کانال‌های دریافت</h2>
          <NotificationPreferences tenant={slug} />
        </section>
      </div>
    </div>
  );
}
