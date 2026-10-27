"use client";

import { useQuery } from "@tanstack/react-query";
import { Megaphone, Newspaper, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDateTime } from "@uni/shared/format";
import { NEWS_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Select } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { Audience, NewsStatus } from "@uni/shared/types";
import { useCan, useSlug } from "@/lib/hooks";

export interface Channel {
  id: string;
  nameFa: string;
  description: string | null;
  unitId: string | null;
  policy: "direct" | "single" | "multi";
  approvalsRequired: number;
  active: boolean;
  myRoles: ("author" | "approver" | "publisher")[];
}

interface Row {
  id: string;
  title: string;
  slug: string;
  status: NewsStatus;
  channelName: string;
  authorName: string;
  publishAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  audience: Audience;
}

const TABS: { key: NewsStatus | ""; label: string }[] = [
  { key: "", label: "همه" },
  { key: "pending_approval", label: "در انتظار تأیید" },
  { key: "draft", label: "پیش‌نویس" },
  { key: "approved", label: "آماده انتشار" },
  { key: "scheduled", label: "زمان‌بندی‌شده" },
  { key: "published", label: "منتشرشده" },
  { key: "archived", label: "بایگانی" },
];

/** Newsroom: posts of the channels the user works in, with the approval queue first (NWS-05). */
export default function NewsAdminPage() {
  const slug = useSlug();
  const can = useCan(slug);
  const [status, setStatus] = useState<NewsStatus | "">("");
  const [channelId, setChannelId] = useState("");
  const channels = useQuery({ queryKey: ["news-channels", slug], queryFn: () => api<Channel[]>("/v1/admin/news-channels", { tenant: slug }) });
  const q = useQuery({
    queryKey: ["news-admin", slug, status, channelId],
    queryFn: () => api<{ items: Row[]; total: number }>("/v1/admin/news", { tenant: slug, query: { status, channelId, limit: 100 } }),
  });
  const writable = (channels.data ?? []).some((c) => c.active && (c.myRoles.includes("author") || c.myRoles.includes("publisher")));

  return (
    <>
      <PageHeader
        eyebrow="اطلاع‌رسانی"
        title="اخبار و اطلاعیه‌ها"
        description="مخاطبان هر خبر جدا از نویسندگان و منتشرکنندگان کانال تعیین می‌شود."
        actions={
          <div className="flex flex-wrap gap-2">
            {can("news.manage") && (
              <Link href={`/t/${slug}/news/channels`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted/60">
                <Settings2 aria-hidden className="size-4" />
                کانال‌ها
              </Link>
            )}
            {writable && (
              <Link href={`/t/${slug}/news/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                <Plus aria-hidden className="size-4" />
                خبر جدید
              </Link>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="وضعیت" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.key || "all"} role="tab" type="button" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={`h-9 cursor-pointer rounded-full px-3.5 text-sm ${status === t.key ? "bg-primary text-on-primary" : "bg-muted/60 hover:bg-muted"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {(channels.data?.length ?? 0) > 1 && (
          <Select aria-label="کانال" value={channelId} onChange={(e) => setChannelId(e.target.value)} className="ms-auto w-auto">
            <option value="">همه کانال‌ها</option>
            {channels.data!.map((c) => (
              <option key={c.id} value={c.id}>{c.nameFa}</option>
            ))}
          </Select>
        )}
      </div>
      <QueryView
        query={q}
        isEmpty={(d) => d.items.length === 0}
        empty={
          channels.data?.length === 0 ? (
            <EmptyState icon={Megaphone} title="شما در هیچ کانال خبری نقشی ندارید" description={can("news.manage") ? "ابتدا یک کانال بسازید و نویسنده و تأییدکننده تعیین کنید." : "برای نوشتن خبر، مدیر اخبار باید شما را به یک کانال اضافه کند."} />
          ) : (
            <EmptyState icon={Newspaper} title="خبری در این فهرست نیست" />
          )
        }
      >
        {(d) => (
          <Table caption="فهرست اخبار">
            <thead>
              <tr>
                <Th>عنوان</Th>
                <Th>کانال</Th>
                <Th>نویسنده</Th>
                <Th>وضعیت</Th>
                <Th>مخاطب</Th>
                <Th>زمان</Th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((n) => (
                <tr key={n.id} className="hover:bg-muted/40">
                  <Td>
                    <Link href={`/t/${slug}/news/${n.id}`} className="font-semibold hover:text-primary hover:underline">{n.title}</Link>
                  </Td>
                  <Td>{n.channelName}</Td>
                  <Td>{n.authorName}</Td>
                  <Td><Badge tone={NEWS_STATUS[n.status].tone}>{NEWS_STATUS[n.status].label}</Badge></Td>
                  <Td>{n.audience.public ? "عمومی" : "داخلی"}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(n.status === "scheduled" ? n.publishAt : n.publishedAt ?? n.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}
