"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Check, Eye, FileText, ImagePlus, Paperclip, Send, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useId, useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtBytes, fmtDateTime } from "@uni/shared/format";
import { CHANNEL_POLICY, NEWS_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { Card, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { Audience, ChannelRole, NewsStatus } from "@uni/shared/types";
import { AudienceBuilder } from "@/components/news/audience";
import { DateTimeInput } from "@/components/news/date-time";
import { RichText } from "@/components/news/rich-text";
import { uploadFile } from "@/components/news/upload";
import { useSlug } from "@/lib/hooks";
import type { Channel } from "../page";

interface FileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
}

interface Post {
  id: string;
  slug: string;
  channelId: string;
  title: string;
  summary: string | null;
  bodyHtml: string;
  coverFileId: string | null;
  attachmentFileIds: string[];
  category: string | null;
  tags: string[];
  source: string | null;
  status: NewsStatus;
  audience: Audience;
  publishAt: string | null;
  expireAt: string | null;
  publishedAt: string | null;
  unpublishReason: string | null;
  version: number;
  authorMembershipId: string;
  channel: { id: string; nameFa: string; policy: "direct" | "single" | "multi"; approvalsRequired: number };
  myRoles: ChannelRole[];
  isAuthor: boolean;
  canUnpublish: boolean;
  files: FileMeta[];
  versions: { version: number; createdAt: string }[];
  approvals: { version: number; decision: "approve" | "return"; note: string | null; createdAt: string; approver: string }[];
  history: { type: string; version: number | null; note: string | null; occurredAt: string; actor: string | null }[];
}

const HISTORY: Record<string, string> = {
  created: "ایجاد",
  updated: "ویرایش",
  submitted: "ارسال برای تأیید",
  approved: "تأیید",
  returned: "برگشت برای اصلاح",
  scheduled: "زمان‌بندی",
  published: "انتشار",
  unpublished: "لغو انتشار",
  archived: "بایگانی",
  restored: "بازگردانی",
  deleted: "حذف",
};

interface Draft {
  channelId: string;
  title: string;
  summary: string;
  bodyHtml: string;
  category: string;
  tags: string;
  source: string;
  coverFileId: string | null;
  attachmentFileIds: string[];
  audience: Audience;
  expireAt: string | null;
}

const toDraft = (p?: Post): Draft => ({
  channelId: p?.channelId ?? "",
  title: p?.title ?? "",
  summary: p?.summary ?? "",
  bodyHtml: p?.bodyHtml ?? "",
  category: p?.category ?? "",
  tags: p?.tags.join("، ") ?? "",
  source: p?.source ?? "",
  coverFileId: p?.coverFileId ?? null,
  attachmentFileIds: p?.attachmentFileIds ?? [],
  audience: p?.audience ?? { members: true },
  expireAt: p?.expireAt ?? null,
});

/** Post editor plus its publishing workflow (NWS-01/05/07/11/12). */
export default function NewsEditorPage() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["news-post", slug, id], enabled: !isNew, queryFn: () => api<Post>(`/v1/admin/news/${id}`, { tenant: slug }) });
  if (isNew) return <Editor />;
  return <QueryView query={q}>{(p) => <Editor key={`${p.id}:${p.version}:${p.status}`} post={p} />}</QueryView>;
}

function Editor({ post }: { post?: Post }) {
  const slug = useSlug();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const bodyLabel = useId();
  const channels = useQuery({ queryKey: ["news-channels", slug], queryFn: () => api<Channel[]>("/v1/admin/news-channels", { tenant: slug }) });
  const [d, setD] = useState<Draft>(() => toDraft(post));
  const [files, setFiles] = useState<FileMeta[]>(post?.files ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"approve" | "return" | "publish" | "unpublish" | "delete" | null>(null);
  const [note, setNote] = useState("");
  const [schedule, setSchedule] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);

  const roles = new Set(post?.myRoles ?? []);
  const publisher = roles.has("publisher");
  const live = post && ["approved", "scheduled", "published"].includes(post.status);
  const editable = !post || (post.status === "draft" && (roles.has("author") || publisher)) || (live && publisher) || (post.status === "pending_approval" && publisher);
  const writable = (channels.data ?? []).filter((c) => c.active && (c.myRoles.includes("author") || c.myRoles.includes("publisher")));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const refresh = () => qc.invalidateQueries({ queryKey: ["news-post", slug, post!.id] });

  const body = () => ({
    title: d.title.trim(),
    summary: d.summary.trim() || undefined,
    bodyHtml: d.bodyHtml,
    category: d.category.trim() || undefined,
    tags: d.tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean),
    source: d.source.trim() || undefined,
    coverFileId: d.coverFileId,
    attachmentFileIds: d.attachmentFileIds,
    audience: d.audience,
    expireAt: d.expireAt,
  });

  const save = async () => {
    if (!d.title.trim()) return setError("عنوان خبر را بنویسید.");
    if (!post && !d.channelId) return setError("کانال را انتخاب کنید.");
    setSaving(true);
    setError(null);
    try {
      if (!post) {
        const p = await api<Post>("/v1/admin/news", { method: "POST", tenant: slug, body: { channelId: d.channelId, ...body() } });
        toast("پیش‌نویس ذخیره شد.");
        router.replace(`/t/${slug}/news/${p.id}`);
      } else {
        await api(`/v1/admin/news/${post.id}`, { method: "PATCH", tenant: slug, body: body() });
        toast("تغییرات ذخیره شد؛ نسخه جدید ثبت شد.");
        await refresh();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const action = async (path: string, payload: unknown, msg: string) => {
    await api(`/v1/admin/news/${post!.id}/${path}`, { method: "POST", tenant: slug, body: payload });
    toast(msg);
    qc.invalidateQueries({ queryKey: ["news-admin", slug] });
    await refresh();
  };
  const quick = async (path: string, msg: string) => {
    try {
      await action(path, {}, msg);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const upload = async (list: FileList | null, kind: "cover" | "attachment") => {
    if (!list?.length) return;
    try {
      for (const f of Array.from(list)) {
        const meta = await uploadFile(slug, f, kind === "cover" ? "news_image" : "news_attachment");
        setFiles((xs) => [...xs, meta]);
        if (kind === "cover") set({ coverFileId: meta.id });
        else setD((x) => ({ ...x, attachmentFileIds: [...x.attachmentFileIds, meta.id] }));
      }
    } catch (e) {
      toast(errorMessage(e));
    }
  };
  const fileName = (fid: string) => files.find((f) => f.id === fid);

  return (
    <>
      <Link href={`/t/${slug}/news`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        اخبار
      </Link>
      <PageHeader
        eyebrow={post ? `${post.channel.nameFa} · ${CHANNEL_POLICY[post.channel.policy]}` : "خبر جدید"}
        title={post?.title || "خبر جدید"}
        actions={
          post && (
            <div className="flex items-center gap-2">
              <Badge tone={NEWS_STATUS[post.status].tone}>{NEWS_STATUS[post.status].label}</Badge>
              {post.status === "published" && (
                <a href={`${process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3000"}/${slug}/news/${encodeURIComponent(post.slug)}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm hover:bg-muted/60">
                  <Eye aria-hidden className="size-4" />
                  مشاهده
                </a>
              )}
            </div>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {post?.unpublishReason && post.status === "archived" && <p role="status" className="rounded-2xl bg-warning-bg p-4 text-sm">انتشار لغو شد: {post.unpublishReason}</p>}
          <Card>
            <fieldset disabled={!editable} className="flex flex-col gap-4">
              {!post && (
                <Field label="کانال" required>
                  {(p) => (
                    <Select {...p} value={d.channelId} onChange={(e) => set({ channelId: e.target.value })}>
                      <option value="">انتخاب کنید</option>
                      {writable.map((c) => (
                        <option key={c.id} value={c.id}>{c.nameFa}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Field label="عنوان" required>
                {(p) => <Input {...p} value={d.title} maxLength={300} onChange={(e) => set({ title: e.target.value })} />}
              </Field>
              <Field label="خلاصه" hint="در فهرست اخبار و پیش‌نمایش شبکه‌های اجتماعی دیده می‌شود.">
                {(p) => <Textarea {...p} value={d.summary} maxLength={1000} onChange={(e) => set({ summary: e.target.value })} />}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span id={bodyLabel} className="text-sm font-medium">متن خبر</span>
                <RichText id={`${bodyLabel}-body`} labelledBy={bodyLabel} value={d.bodyHtml} onChange={(html) => set({ bodyHtml: html })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="دسته‌بندی">{(p) => <Input {...p} value={d.category} maxLength={60} onChange={(e) => set({ category: e.target.value })} />}</Field>
                <Field label="برچسب‌ها" hint="با ویرگول جدا کنید.">{(p) => <Input {...p} value={d.tags} onChange={(e) => set({ tags: e.target.value })} />}</Field>
                <Field label="منبع">{(p) => <Input {...p} value={d.source} maxLength={300} onChange={(e) => set({ source: e.target.value })} />}</Field>
              </div>
            </fieldset>
          </Card>

          <Card title="تصویر و پیوست‌ها">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {d.coverFileId ? (
                  <span className="inline-flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                    <ImagePlus aria-hidden className="size-4" />
                    تصویر شاخص: {fileName(d.coverFileId)?.originalName ?? "انتخاب‌شده"}
                    {editable && (
                      <button type="button" aria-label="حذف تصویر شاخص" onClick={() => set({ coverFileId: null })} className="grid size-7 cursor-pointer place-items-center rounded-lg hover:bg-card">
                        <X aria-hidden className="size-4" />
                      </button>
                    )}
                  </span>
                ) : (
                  editable && (
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 text-sm hover:border-primary/50">
                      <ImagePlus aria-hidden className="size-4" />
                      تصویر شاخص (PNG/JPEG/WebP تا ۵ مگابایت)
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void upload(e.target.files, "cover")} />
                    </label>
                  )
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {d.attachmentFileIds.map((fid) => {
                  const f = fileName(fid);
                  return (
                    <li key={fid} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                      <FileText aria-hidden className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f?.originalName ?? fid.slice(0, 8)}</span>
                      {f && <span className="text-xs text-muted-foreground">{fmtBytes(f.sizeBytes)}</span>}
                      {editable && (
                        <button type="button" aria-label={`حذف ${f?.originalName ?? "پیوست"}`} onClick={() => set({ attachmentFileIds: d.attachmentFileIds.filter((x) => x !== fid) })} className="grid size-7 cursor-pointer place-items-center rounded-lg hover:bg-card">
                          <X aria-hidden className="size-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {editable && (
                <label className="inline-flex h-10 w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 text-sm hover:border-primary/50">
                  <Paperclip aria-hidden className="size-4" />
                  افزودن پیوست (PDF، Word، Excel، تصویر)
                  <input type="file" multiple className="sr-only" onChange={(e) => void upload(e.target.files, "attachment")} />
                </label>
              )}
              <p className="text-xs text-muted-foreground">پیوست‌های خبر داخلی فقط برای همان مخاطبان قابل دریافت است.</p>
            </div>
          </Card>

          <AudienceBuilder slug={slug} value={d.audience} onChange={(a) => set({ audience: a })} disabled={!editable} />

          <Card title="پایان نمایش">
            <Field label="بایگانی خودکار در" hint="اختیاری؛ پس از این زمان خبر از فهرست‌ها خارج می‌شود.">
              {(p) => <DateTimeInput id={p.id} value={d.expireAt} onChange={(v) => set({ expireAt: v })} />}
            </Field>
          </Card>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {editable && (
            <div className="flex gap-2">
              <Button loading={saving} onClick={() => void save()}>{post ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}</Button>
            </div>
          )}
        </div>

        {post && (
          <aside className="flex flex-col gap-4">
            <Card title="گردش انتشار">
              <div className="flex flex-col gap-2">
                {post.status === "draft" && (roles.has("author") || publisher) && (
                  <Button onClick={() => void quick("submit", post.channel.policy === "direct" ? "آماده انتشار شد." : "برای تأیید ارسال شد.")}>
                    <Send aria-hidden className="size-4" />
                    {post.channel.policy === "direct" ? "آماده انتشار" : "ارسال برای تأیید"}
                  </Button>
                )}
                {post.status === "pending_approval" && roles.has("approver") && !post.isAuthor && (
                  <>
                    <Button onClick={() => { setNote(""); setDialog("approve"); }}>
                      <Check aria-hidden className="size-4" />
                      تأیید
                    </Button>
                    <Button variant="secondary" onClick={() => { setNote(""); setDialog("return"); }}>
                      <Undo2 aria-hidden className="size-4" />
                      برگشت برای اصلاح
                    </Button>
                  </>
                )}
                {publisher && (post.status === "approved" || (post.status === "draft" && post.channel.policy === "direct")) && (
                  <Button onClick={() => { setSchedule(null); setNotify(false); setDialog("publish"); }}>
                    <CalendarClock aria-hidden className="size-4" />
                    انتشار یا زمان‌بندی
                  </Button>
                )}
                {(post.status === "published" || post.status === "scheduled") && post.canUnpublish && (
                  <Button variant="danger" onClick={() => setDialog("unpublish")}>لغو فوری انتشار</Button>
                )}
                {post.status === "published" && publisher && <Button variant="secondary" onClick={() => void quick("archive", "بایگانی شد.")}>بایگانی</Button>}
                {post.status === "archived" && publisher && <Button variant="secondary" onClick={() => void quick("restore", "به پیش‌نویس برگشت.")}>بازگردانی به پیش‌نویس</Button>}
                {publisher && post.status !== "published" && <Button variant="ghost" className="text-danger" onClick={() => setDialog("delete")}>حذف خبر</Button>}
                {post.status === "scheduled" && <p className="text-sm text-muted-foreground">انتشار در {fmtDateTime(post.publishAt)}</p>}
                {post.status === "pending_approval" && post.isAuthor && <p className="text-sm leading-7 text-muted-foreground">در انتظار تأیید یک تأییدکننده دیگر؛ نویسنده خبر خودش را تأیید نمی‌کند.</p>}
                {post.status === "pending_approval" && post.channel.policy === "multi" && (
                  <p className="text-sm text-muted-foreground">
                    {post.approvals.filter((a) => a.version === post.version && a.decision === "approve").length} از {post.channel.approvalsRequired} تأیید
                  </p>
                )}
              </div>
            </Card>
            {post.approvals.length > 0 && (
              <Card title="تأییدها">
                <ul className="flex flex-col gap-3 text-sm">
                  {post.approvals.map((a, i) => (
                    <li key={i}>
                      <p className="font-semibold">
                        {a.approver} · <span className={a.decision === "approve" ? "text-success" : "text-danger"}>{a.decision === "approve" ? "تأیید" : "برگشت"}</span>
                        <span className="font-normal text-muted-foreground"> (نسخه {a.version})</span>
                      </p>
                      {a.note && <p className="mt-0.5 text-muted-foreground">{a.note}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title="تاریخچه">
              <ol className="flex flex-col gap-3 border-s border-border ps-4 text-sm">
                {post.history.map((h, i) => (
                  <li key={i}>
                    <p className="font-semibold">{HISTORY[h.type] ?? h.type}{h.version ? ` · نسخه ${h.version}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{h.actor ?? "سامانه"} · {fmtDateTime(h.occurredAt)}</p>
                    {h.note && <p className="mt-0.5 text-muted-foreground">{h.note}</p>}
                  </li>
                ))}
              </ol>
            </Card>
          </aside>
        )}
      </div>

      {post && (
        <>
          <FormDialog open={dialog === "approve" || dialog === "return"} onClose={() => setDialog(null)} title={dialog === "approve" ? "تأیید خبر" : "برگشت برای اصلاح"} submitLabel={dialog === "approve" ? "تأیید" : "برگشت"} onSubmit={() => (dialog === "approve" ? action("approve", { note: note.trim() || undefined }, "تأیید ثبت شد.") : action("return", { note: note.trim() }, "به نویسنده برگشت."))}>
            <Field label={dialog === "approve" ? "یادداشت (اختیاری)" : "چه چیزی باید اصلاح شود؟"} required={dialog === "return"}>
              {(p) => <Textarea {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </FormDialog>
          <FormDialog open={dialog === "publish"} onClose={() => setDialog(null)} title="انتشار خبر" submitLabel={schedule ? "زمان‌بندی" : "انتشار اکنون"} onSubmit={() => action("publish", { publishAt: schedule ?? undefined, notify }, schedule ? "زمان‌بندی شد." : "منتشر شد.")}>
            <Field label="زمان انتشار" hint="خالی بگذارید تا همین الان منتشر شود.">
              {(p) => <DateTimeInput id={p.id} value={schedule} onChange={setSchedule} />}
            </Field>
            <Checkbox label="اعلان درون‌برنامه‌ای به مخاطبان" description="فقط به کسانی که اجازه دیدن خبر را دارند؛ پیامک ارسال نمی‌شود." checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          </FormDialog>
          <ReasonDialog open={dialog === "unpublish"} onClose={() => setDialog(null)} title="لغو فوری انتشار" description="خبر بلافاصله از همه فهرست‌ها و پیوندها خارج می‌شود." submitLabel="لغو انتشار" onConfirm={(reason) => action("unpublish", { reason }, "انتشار لغو شد.")} />
          <ReasonDialog
            open={dialog === "delete"}
            onClose={() => setDialog(null)}
            title="حذف خبر"
            submitLabel="حذف"
            onConfirm={async (reason) => {
              await api(`/v1/admin/news/${post.id}/delete`, { method: "POST", tenant: slug, body: { reason } });
              toast("حذف شد.");
              qc.invalidateQueries({ queryKey: ["news-admin", slug] });
              router.replace(`/t/${slug}/news`);
            }}
          />
        </>
      )}
    </>
  );
}
