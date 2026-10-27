"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, FileText, Lock, Newspaper } from "lucide-react";
import Link from "next/link";
import { api, ApiError } from "@uni/shared/api";
import { fmtBytes, fmtDate } from "@uni/shared/format";
import { openFile } from "@uni/shared/ui/form-fields";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { NewsArticle } from "@uni/shared/types";
import { useTenantSlug } from "@/lib/tenant";

/** One post. A post the viewer may not see is reported as missing — no title leak (NWS-10). */
export function NewsArticleView({ slug }: { slug: string }) {
  const tenant = useTenantSlug();
  const q = useQuery({
    queryKey: ["news-article", tenant, slug],
    queryFn: () => api<NewsArticle>(`/v1/news/${encodeURIComponent(slug)}`, { tenant, public: true }),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const fileUrl = (p: NewsArticle, id: string) => `/api/proxy/v1/tenants/${tenant}/news/${encodeURIComponent(p.slug)}/files/${id}`;

  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={Newspaper}
          title="این خبر پیدا نشد"
          description="ممکن است حذف شده باشد یا فقط برای گروه خاصی منتشر شده باشد؛ اگر عضو دانشگاه هستید وارد شوید."
          action={
            <Link href={`/${tenant}/login?next=${encodeURIComponent(`/${tenant}/news/${encodeURIComponent(slug)}`)}`} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
              ورود
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <QueryView query={q}>
      {(p) => (
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <Link href={`/${tenant}/news`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight aria-hidden className="size-4" />
            همه اخبار
          </Link>
          <header className="flex flex-col gap-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{p.channelName}</span>
              {p.category && <><span aria-hidden>·</span><span>{p.category}</span></>}
              <span aria-hidden>·</span>
              <time dateTime={p.publishedAt ?? undefined}>{fmtDate(p.publishedAt)}</time>
              {!p.isPublic && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                  <Lock aria-hidden className="size-3.5" />
                  ویژه مخاطبان مشخص
                </span>
              )}
            </p>
            <h1 className="text-2xl font-black leading-[1.6] sm:text-3xl">{p.title}</h1>
            {p.summary && <p className="text-lg leading-8 text-muted-foreground">{p.summary}</p>}
          </header>
          {p.coverFileId && p.isPublic && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(p, p.coverFileId)} alt="" className="aspect-[16/9] w-full rounded-3xl object-cover" />
          )}
          {/* the body was sanitised on the server with an allow-list (NWS-08) */}
          <div className="rich" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
          {p.attachments.length > 0 && (
            <section aria-labelledby="att" className="rounded-3xl border border-border bg-card p-5">
              <h2 id="att" className="font-bold">پیوست‌ها</h2>
              <ul className="mt-3 grid gap-2">
                {p.attachments.map((f) => (
                  <li key={f.id}>
                    {p.isPublic ? (
                      <a href={fileUrl(p, f.id)} target="_blank" rel="noopener" className="flex min-h-11 items-center gap-3 rounded-2xl px-3 hover:bg-muted">
                        <FileText aria-hidden className="size-5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{f.originalName}</span>
                        <span className="text-xs text-muted-foreground">{fmtBytes(f.sizeBytes)}</span>
                        <Download aria-hidden className="size-4" />
                      </a>
                    ) : (
                      <button type="button" onClick={() => void openFile(tenant, f.id)} className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-start hover:bg-muted">
                        <FileText aria-hidden className="size-5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{f.originalName}</span>
                        <span className="text-xs text-muted-foreground">{fmtBytes(f.sizeBytes)}</span>
                        <Download aria-hidden className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(p.tags.length > 0 || p.source) && (
            <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-5 text-sm text-muted-foreground">
              {p.tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-3 py-1">#{t}</span>
              ))}
              {p.source && <span className="ms-auto">منبع: {p.source}</span>}
            </footer>
          )}
        </article>
      )}
    </QueryView>
  );
}
