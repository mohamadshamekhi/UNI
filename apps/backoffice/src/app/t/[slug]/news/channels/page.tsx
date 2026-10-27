"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Megaphone, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { CHANNEL_POLICY, CHANNEL_ROLE } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Dialog, FormDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { PageHeader } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { ChannelPolicy, ChannelRole, MembershipRow } from "@uni/shared/types";
import { useSlug, useUnits } from "@/lib/hooks";
import type { Channel } from "../page";

const EMPTY = { nameFa: "", description: "", unitId: "", policy: "single" as ChannelPolicy, approvalsRequired: 2, active: true };

/** Channels and who may write / approve / publish in each (NWS-03/04). */
export default function NewsChannelsPage() {
  const slug = useSlug();
  const { flat } = useUnits(slug);
  const q = useQuery({ queryKey: ["news-channels", slug], queryFn: () => api<Channel[]>("/v1/admin/news-channels", { tenant: slug }) });
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const [members, setMembers] = useState<Channel | null>(null);
  return (
    <>
      <Link href={`/t/${slug}/news`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        اخبار
      </Link>
      <PageHeader
        eyebrow="اطلاع‌رسانی"
        title="کانال‌های خبری"
        description="هر کانال سیاست انتشار خودش را دارد؛ دسترسی کانال فقط اجازه نوشتن و انتشار در همان کانال را می‌دهد."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden className="size-4" />
            کانال جدید
          </Button>
        }
      />
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Megaphone} title="هنوز کانالی ساخته نشده" />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{c.nameFa}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{c.unitId ? flat.find((u) => u.id === c.unitId)?.label : "کل دانشگاه"}</p>
                  </div>
                  <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "فعال" : "غیرفعال"}</Badge>
                </div>
                <p className="text-sm">
                  سیاست: <span className="font-semibold">{CHANNEL_POLICY[c.policy]}</span>
                  {c.policy === "multi" && ` (${c.approvalsRequired} تأیید)`}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                    <Pencil aria-hidden className="size-4" />
                    ویرایش
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setMembers(c)}>
                    <UserPlus aria-hidden className="size-4" />
                    اعضای کانال
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      <ChannelDialog target={editing} onClose={() => setEditing(null)} />
      <MembersDialog channel={members} onClose={() => setMembers(null)} />
    </>
  );
}

function ChannelDialog({ target, onClose }: { target: Channel | "new" | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { flat } = useUnits(slug);
  const [v, setV] = useState(EMPTY);
  const [last, setLast] = useState(target);
  if (target !== last) {
    setLast(target);
    if (target) setV(target === "new" ? EMPTY : { ...EMPTY, ...target, description: target.description ?? "", unitId: target.unitId ?? "" });
  }
  return (
    <FormDialog
      open={!!target}
      onClose={onClose}
      title={target === "new" ? "کانال جدید" : "ویرایش کانال"}
      submitLabel="ذخیره"
      onSubmit={async () => {
        const body = { nameFa: v.nameFa.trim(), description: v.description.trim() || undefined, policy: v.policy, approvalsRequired: v.policy === "multi" ? v.approvalsRequired : undefined };
        if (target === "new") await api("/v1/admin/news-channels", { method: "POST", tenant: slug, body: { ...body, unitId: v.unitId || undefined } });
        else await api(`/v1/admin/news-channels/${(target as Channel).id}`, { method: "PATCH", tenant: slug, body: { ...body, active: v.active } });
        qc.invalidateQueries({ queryKey: ["news-channels", slug] });
        toast("کانال ذخیره شد.");
      }}
    >
      <Field label="نام کانال" required>
        {(p) => <Input {...p} value={v.nameFa} maxLength={120} onChange={(e) => setV({ ...v, nameFa: e.target.value })} />}
      </Field>
      <Field label="توضیح">
        {(p) => <Textarea {...p} value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />}
      </Field>
      {target === "new" && (
        <Field label="واحد مالک" hint="خالی یعنی کانال کل دانشگاه.">
          {(p) => (
            <Select {...p} value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}>
              <option value="">کل دانشگاه</option>
              {flat.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="سیاست انتشار" hint="انتشار مستقیم: منتشرکننده بدون تأیید منتشر می‌کند. نویسنده هیچ‌وقت خبر خودش را تأیید نمی‌کند.">
        {(p) => (
          <Select {...p} value={v.policy} onChange={(e) => setV({ ...v, policy: e.target.value as ChannelPolicy })}>
            {Object.entries(CHANNEL_POLICY).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </Select>
        )}
      </Field>
      {v.policy === "multi" && (
        <Field label="تعداد تأیید لازم">
          {(p) => <Input {...p} type="number" dir="ltr" min={2} max={5} value={v.approvalsRequired} onChange={(e) => setV({ ...v, approvalsRequired: Math.min(5, Math.max(2, Number(e.target.value) || 2)) })} />}
        </Field>
      )}
      {target !== "new" && <Checkbox label="فعال" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />}
    </FormDialog>
  );
}

function MembersDialog({ channel, onClose }: { channel: Channel | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [role, setRole] = useState<ChannelRole>("author");
  const [busy, setBusy] = useState(false);
  const key = ["news-channel-members", slug, channel?.id];
  const list = useQuery({
    queryKey: key,
    enabled: !!channel,
    queryFn: () => api<{ membershipId: string; role: ChannelRole; fullName: string }[]>(`/v1/admin/news-channels/${channel!.id}/members`, { tenant: slug }),
  });
  const people = useQuery({
    queryKey: ["memberships-pick", slug, search],
    enabled: !!channel,
    queryFn: () => api<{ items: MembershipRow[] }>("/v1/admin/memberships", { tenant: slug, query: { status: "active", q: search || undefined, limit: 20 } }),
  });
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
      toast(msg);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!channel} onClose={onClose} title={`اعضای «${channel?.nameFa ?? ""}»`} wide>
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 rounded-2xl bg-muted/50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="جست‌وجو">{(p) => <Input {...p} value={search} placeholder="نام یا شماره" onChange={(e) => setSearch(e.target.value)} />}</Field>
          <Field label="شخص">
            {(p) => (
              <Select {...p} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
                <option value="">انتخاب کنید</option>
                {people.data?.items.map((m) => (
                  <option key={m.id} value={m.id}>{m.fullName}{m.unitNameFa ? ` — ${m.unitNameFa}` : ""}</option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex gap-2">
            <Select aria-label="نقش در کانال" value={role} onChange={(e) => setRole(e.target.value as ChannelRole)}>
              {Object.entries(CHANNEL_ROLE).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </Select>
            <Button
              disabled={!membershipId}
              loading={busy}
              onClick={() => void act(() => api(`/v1/admin/news-channels/${channel!.id}/members`, { method: "POST", tenant: slug, body: { membershipId, role } }), "عضو اضافه شد.")}
            >
              افزودن
            </Button>
          </div>
        </div>
        <QueryView query={list} isEmpty={(d) => d.length === 0} empty={<p className="text-sm text-muted-foreground">هنوز کسی به این کانال اضافه نشده است.</p>}>
          {(rows) => (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={`${r.membershipId}-${r.role}`} className="flex items-center gap-3 py-2.5">
                  <span className="flex-1">{r.fullName}</span>
                  <Badge tone="info">{CHANNEL_ROLE[r.role]}</Badge>
                  <button
                    type="button"
                    aria-label={`حذف ${r.fullName} از نقش ${CHANNEL_ROLE[r.role]}`}
                    onClick={() => void act(() => api(`/v1/admin/news-channels/${channel!.id}/members/${r.membershipId}/${r.role}`, { method: "DELETE", tenant: slug }), "حذف شد.")}
                    className="grid size-9 cursor-pointer place-items-center rounded-lg text-danger hover:bg-danger-bg"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </div>
    </Dialog>
  );
}
