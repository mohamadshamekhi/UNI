"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDate } from "@uni/shared/format";
import { PAPER_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { PaperStatus } from "@uni/shared/types";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

interface Row {
  id: string;
  trackingCode: string | null;
  title: string;
  status: PaperStatus;
  round: number;
  revisionDueAt: string | null;
  createdAt: string;
  trackName: string;
}

/** The author's papers (PAP-01) with their review status. */
export default function MyPapersPage() {
  const slug = useTenantSlug();
  const q = useQuery({ queryKey: ["my-papers", slug], queryFn: () => api<Row[]>("/v1/me/papers", { tenant: slug }) });
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm text-white/70">پژوهش</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">مقالات من</h1>
            <p className="mt-2 max-w-xl leading-7 text-white/75">ارسال مقاله برای داوری علمی و پیگیری دورهای داوری و تصمیم نهایی.</p>
          </div>
          <Link href={`/${slug}/papers/new`} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#0b1f52] shadow-lg hover:bg-white/90">
            <Plus aria-hidden className="size-4" />
            ارسال مقاله
          </Link>
        </div>
      </section>
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={FileText} title="هنوز مقاله‌ای ارسال نکرده‌اید" description="فایل مقاله و مقطع تحصیلی کافی است؛ بقیه اطلاعات به داوری بهتر کمک می‌کند." />}>
        {(list) => (
          <ul className="grid gap-3">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/${slug}/papers/${p.id}`} className="group flex items-center gap-4 rounded-3xl border border-border bg-card p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold">{p.title}</p>
                      <Badge tone={PAPER_STATUS[p.status].tone}>{PAPER_STATUS[p.status].label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {p.trackName}
                      {p.trackingCode && <> · <span dir="ltr" className="font-mono">{p.trackingCode}</span></>}
                      {p.revisionDueAt && p.status === "revision_requested" && <> · مهلت اصلاح {fmtDate(p.revisionDueAt)}</>}
                    </p>
                  </div>
                  <ChevronLeft aria-hidden className="size-5 text-muted-foreground transition-transform group-hover:-translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
