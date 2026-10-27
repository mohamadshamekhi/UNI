import type { Metadata } from "next";
import { API_URL } from "@uni/shared/bff/session";
import { NewsArticleView } from "./article";

type Params = Promise<{ tenant: string; slug: string }>;

/**
 * NWS-14: public posts get title/description/Open Graph metadata (fetched anonymously, so only
 * public posts ever resolve here); everything else is marked noindex.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tenant, slug } = await params;
  try {
    const res = await fetch(`${API_URL}/v1/news/${encodeURIComponent(decodeURIComponent(slug))}`, { headers: { "x-tenant": tenant }, next: { revalidate: 60 } });
    if (!res.ok) return { title: "خبر", robots: { index: false, follow: false } };
    const p = (await res.json()) as { title: string; summary: string; slug: string; coverFileId: string | null; publishedAt: string | null; isPublic: boolean };
    if (!p.isPublic) return { title: "خبر", robots: { index: false, follow: false } };
    const image = p.coverFileId ? `/api/proxy/v1/tenants/${tenant}/news/${encodeURIComponent(p.slug)}/files/${p.coverFileId}` : undefined;
    return {
      title: p.title,
      description: p.summary,
      alternates: { canonical: `/${tenant}/news/${encodeURIComponent(p.slug)}` },
      openGraph: { type: "article", title: p.title, description: p.summary, publishedTime: p.publishedAt ?? undefined, images: image ? [image] : undefined, locale: "fa_IR" },
    };
  } catch {
    return { title: "خبر", robots: { index: false, follow: false } };
  }
}

export default async function NewsArticlePage({ params }: { params: Params }) {
  const { slug } = await params;
  return <NewsArticleView slug={decodeURIComponent(slug)} />;
}
