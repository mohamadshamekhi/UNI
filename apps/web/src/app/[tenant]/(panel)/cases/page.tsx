"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDate } from "@uni/shared/format";
import { caseRef, CaseStatusBadge } from "@uni/shared/ui/case";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { CaseListItem } from "@uni/shared/types";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

/** The applicant's own requests (cases), newest first. */
export default function MyCasesPage() {
  const slug = useTenantSlug();
  const q = useQuery({
    queryKey: ["my-cases", slug],
    queryFn: () => api<{ items: CaseListItem[]; total: number }>("/v1/me/cases", { tenant: slug, query: { limit: 50 } }),
  });
  const newLink = (
    <Link href={`/${slug}/cases/new`} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#0b1f52] shadow-lg transition-colors hover:bg-white/90">
      <Plus aria-hidden className="size-4" />
      درخواست جدید
    </Link>
  );
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm text-white/70">خدمات دانشگاه</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">پرونده‌های من</h1>
            <p className="mt-2 max-w-xl leading-7 text-white/75">درخواست‌هایی که ثبت کرده‌اید و مرحله فعلی هرکدام. هر تغییر با اعلان به شما اطلاع داده می‌شود.</p>
          </div>
          {newLink}
        </div>
      </section>

      <QueryView
        query={q}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            icon={FolderOpen}
            title="هنوز درخواستی ثبت نکرده‌اید"
            description="برای شروع، نوع درخواست را انتخاب کنید؛ مراحل بررسی را همین‌جا دنبال می‌کنید."
            action={
              <Link href={`/${slug}/cases/new`} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                <Plus aria-hidden className="size-4" />
                ثبت درخواست
              </Link>
            }
          />
        }
      >
        {(d) => (
          <ul className="grid gap-3">
            {d.items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/${slug}/cases/${c.id}`}
                  className="group flex items-center gap-4 rounded-3xl border border-border bg-card p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_20px_40px_-28px_var(--primary)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold">{c.title || c.workflowName}</p>
                      <CaseStatusBadge status={c.statusCategory} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.workflowName} · <span className="font-mono" dir="ltr">{caseRef(c.id)}</span> · <span className="tabular">{fmtDate(c.createdAt)}</span>
                    </p>
                  </div>
                  <ChevronLeft aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-1 group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
