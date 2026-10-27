"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, Newspaper, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDate } from "@uni/shared/format";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { NewsCard } from "@uni/shared/types";
import { HeroBackdrop } from "@/components/site/sections";
import { useTenantSlug } from "@/lib/tenant";

const PAGE = 12;

/** News feed (NWS-10): the API returns only posts this viewer may see. */
export default function NewsFeedPage() {
  const slug = useTenantSlug();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);
  const feed = useQuery({
    queryKey: ["news", slug, q, category, limit],
    queryFn: () => api<{ items: NewsCard[]; total: number }>("/v1/news", { tenant: slug, public: true, query: { q, category, limit } }),
    placeholderData: keepPreviousData,
  });
  const categories = [...new Set((feed.data?.items ?? []).map((n) => n.category).filter((c): c is string => !!c))];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <p className="text-sm text-white/70">خبرها و اطلاعیه‌ها</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">اخبار</h1>
        <label className="relative mt-5 block max-w-lg">
          <span className="sr-only">جستجو در اخبار</span>
          <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-white/60" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="جستجو در عنوان و خلاصه…"
            className="h-12 w-full rounded-full border border-white/20 bg-white/10 ps-11 pe-4 text-white placeholder:text-white/55 focus:border-white/50 focus:outline-none"
          />
        </label>
      </section>

      {(categories.length > 0 || category) && (
        <div role="group" aria-label="دسته‌بندی" className="flex flex-wrap gap-2">
          {["", ...(category && !categories.includes(category) ? [category] : []), ...categories].map((c) => (
            <button
              key={c || "all"}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`h-10 cursor-pointer rounded-full border px-4 text-sm transition-colors ${category === c ? "border-primary bg-primary text-on-primary" : "border-border bg-card hover:border-primary/40"}`}
            >
              {c || "همه"}
            </button>
          ))}
        </div>
      )}

      <QueryView query={feed} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={Newspaper} title={q ? "خبری با این عبارت پیدا نشد" : "هنوز خبری منتشر نشده است"} />}>
        {(d) => (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.items.map((n) => (
                <li key={n.id}>
                  <Link href={`/${slug}/news/${encodeURIComponent(n.slug)}`} className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
                    <div className="aspect-[16/9] bg-muted">
                      {n.coverFileId && n.isPublic ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/proxy/v1/tenants/${slug}/news/${encodeURIComponent(n.slug)}/files/${n.coverFileId}`} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center text-muted-foreground">
                          <Newspaper aria-hidden className="size-8" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{n.channelName}</span>
                        <span aria-hidden>·</span>
                        <time dateTime={n.publishedAt ?? undefined}>{fmtDate(n.publishedAt)}</time>
                        {!n.isPublic && (
                          <span className="ms-auto inline-flex items-center gap-1" title="فقط برای مخاطبان مشخص">
                            <Lock aria-hidden className="size-3.5" />
                            داخلی
                          </span>
                        )}
                      </p>
                      <h2 className="line-clamp-2 font-bold leading-7 group-hover:text-primary">{n.title}</h2>
                      {n.summary && <p className="line-clamp-3 text-sm leading-7 text-muted-foreground">{n.summary}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {d.total > d.items.length && (
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="mx-auto h-11 cursor-pointer rounded-full border border-border bg-card px-6 text-sm font-semibold hover:border-primary/40">
                {feed.isFetching ? "در حال بارگذاری…" : "خبرهای بیشتر"}
              </button>
            )}
          </>
        )}
      </QueryView>
    </div>
  );
}
