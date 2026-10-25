"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, Eye, FileText, FileWarning } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { RoleAssignments } from "@/components/membership/role-assignments";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { Card, Dl, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import { api, errorMessage } from "@uni/shared/api";
import { fmtBytes, fmtDate, fmtDateTime, toFaDigits } from "@uni/shared/format";
import { useCan, useSlug, useUnits } from "@/lib/hooks";
import { MEMBERSHIP_EVENT, MEMBERSHIP_KIND, MEMBERSHIP_STATUS, REVISABLE_FIELDS } from "@uni/shared/labels";
import type { FileInfo, MembershipDetail } from "@uni/shared/types";

type Action = "approve" | "reject" | "revision" | "transfer" | "suspend" | "reactivate" | "end" | null;

const PROFILE_LABELS: Record<string, string> = { degree: "مقطع", field: "رشته", entryYear: "سال ورود", academicRank: "مرتبه علمی", orcid: "ORCID" };

export default function MembershipDetailPage() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["membership", slug, id], queryFn: () => api<MembershipDetail>(`/v1/admin/memberships/${id}`, { tenant: slug }) });
  return (
    <>
      <Link href={`/t/${slug}/memberships`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        عضویت‌ها
      </Link>
      <QueryView query={q}>{(m) => <Detail m={m} />}</QueryView>
    </>
  );
}

function Detail({ m }: { m: MembershipDetail }) {
  const slug = useSlug();
  const can = useCan(slug);
  const qc = useQueryClient();
  const toast = useToast();
  const { byId } = useUnits(slug);
  const [action, setAction] = useState<Action>(null);
  const st = MEMBERSHIP_STATUS[m.status];
  const reviewable = m.status === "pending_review" || m.status === "needs_revision";
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["membership", slug, m.id] });
    qc.invalidateQueries({ queryKey: ["memberships", slug] });
    qc.invalidateQueries({ queryKey: ["membership-count", slug] });
    toast(msg);
  };
  const post = (path: string, body: unknown) => api(`/v1/admin/memberships/${m.id}/${path}`, { method: "POST", tenant: slug, body });

  return (
    <>
      <PageHeader
        title={m.user.fullName}
        description={`${MEMBERSHIP_KIND[m.kind]} · ${byId.get(m.reviewUnitId ?? "")?.label ?? "—"}`}
        actions={
          <>
            {can("membership.approve") && m.status === "pending_review" && <Button onClick={() => setAction("approve")}>تأیید عضویت</Button>}
            {can("membership.approve") && m.status === "pending_review" && (
              <Button variant="secondary" onClick={() => setAction("revision")}>درخواست اصلاح</Button>
            )}
            {can("membership.approve") && reviewable && <Button variant="secondary" onClick={() => setAction("transfer")}>انتقال به واحد دیگر</Button>}
            {can("membership.approve") && reviewable && <Button variant="danger" onClick={() => setAction("reject")}>رد درخواست</Button>}
            {can("membership.manage") && m.status === "active" && <Button variant="danger" onClick={() => setAction("suspend")}>تعلیق</Button>}
            {can("membership.manage") && m.status === "suspended" && <Button onClick={() => setAction("reactivate")}>رفع تعلیق</Button>}
            {can("membership.manage") && (m.status === "active" || m.status === "suspended") && (
              <Button variant="secondary" onClick={() => setAction("end")}>پایان عضویت</Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card title="اطلاعات درخواست">
            <Dl
              items={[
                ["وضعیت", <Badge key="s" tone={st.tone}>{st.label}</Badge>],
                ["شماره دانشجویی/پرسنلی", <span key="n" className="tabular">{m.memberNo ? toFaDigits(m.memberNo) : "—"}</span>],
                ["موبایل", <span key="mo" dir="ltr" className="tabular">{m.user.mobile}</span>],
                ["ایمیل", m.user.email ? <span key="e" dir="ltr">{m.user.email}</span> : "—"],
                ["تاریخ ثبت", <span key="d" className="tabular">{fmtDateTime(m.submittedAt)}</span>],
                ["تاریخ تصمیم", <span key="dd" className="tabular">{fmtDateTime(m.decidedAt)}</span>],
                ...Object.entries(m.profile).map(([k, v]) => [PROFILE_LABELS[k] ?? k, String(v)] as [string, string]),
                ...(m.units.length > 1
                  ? [["واحدهای دیگر", m.units.filter((u) => !u.isPrimary).map((u) => byId.get(u.unitId)?.label ?? u.unitId).join("، ")] as [string, string]]
                  : []),
              ]}
            />
            {m.status === "needs_revision" && m.revisionRequest && (
              <div className="mt-4 rounded-md bg-warning-bg p-3 text-sm text-warning">
                <p className="font-medium">اصلاح خواسته‌شده: {m.revisionRequest.fields.map((f) => REVISABLE_FIELDS[f] ?? f).join("، ")}</p>
                <p className="mt-1">{m.revisionRequest.reason}</p>
                <p className="mt-1 tabular">مهلت: {fmtDate(m.revisionDeadline)}</p>
              </div>
            )}
            {m.status === "rejected" && m.decisionReason && <p className="mt-4 rounded-md bg-danger-bg p-3 text-sm text-danger">دلیل رد: {m.decisionReason}</p>}
          </Card>
          <Documents files={m.documents} />
          {can("role.manage") && m.status === "active" && <RoleAssignments membershipId={m.id} />}
        </div>
        <Card title="تاریخچه پرونده">
          <ol className="flex flex-col gap-4">
            {m.history.map((e) => (
              <li key={e.id} className="border-s-2 border-border ps-3">
                <p className="text-sm font-medium">{MEMBERSHIP_EVENT[e.type] ?? e.type}</p>
                <p className="text-xs text-muted-foreground tabular">{fmtDateTime(e.occurredAt)}</p>
                {e.publicNote && <p className="mt-1 text-sm">{e.publicNote}</p>}
                {e.internalNote && (
                  <p className="mt-1 rounded bg-muted px-2 py-1 text-xs">
                    <span className="font-medium">یادداشت داخلی: </span>
                    {e.internalNote}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <FormDialog
        open={action === "approve"}
        onClose={() => setAction(null)}
        title="تأیید عضویت"
        submitLabel="تأیید"
        onSubmit={async () => {
          await post("approve", {});
          done("عضویت تأیید شد و پیامک ارسال می‌شود.");
        }}
      >
        <p className="text-sm">با تأیید، نقش پایه «{MEMBERSHIP_KIND[m.kind]}» فعال می‌شود و به {m.user.fullName} اطلاع داده می‌شود.</p>
      </FormDialog>
      <RejectDialog open={action === "reject"} onClose={() => setAction(null)} onSubmit={async (b) => { await post("reject", b); done("درخواست رد شد."); }} />
      <RevisionDialog open={action === "revision"} onClose={() => setAction(null)} onSubmit={async (b) => { await post("request-revision", b); done("درخواست اصلاح ثبت شد."); }} />
      <TransferDialog open={action === "transfer"} onClose={() => setAction(null)} currentUnitId={m.reviewUnitId} onSubmit={async (b) => { await post("transfer", b); done("درخواست به واحد جدید منتقل شد."); }} />
      <ReasonDialog open={action === "suspend"} onClose={() => setAction(null)} title="تعلیق عضویت" description="دسترسی فرد به این سازمان تا رفع تعلیق بسته می‌شود؛ حساب و سوابق حذف نمی‌شوند." submitLabel="تعلیق" onConfirm={async (reason) => { await post("suspend", { reason }); done("عضویت معلق شد."); }} />
      <ReasonDialog open={action === "reactivate"} onClose={() => setAction(null)} title="رفع تعلیق" submitLabel="فعال‌سازی" danger={false} onConfirm={async (reason) => { await post("reactivate", { reason }); done("عضویت دوباره فعال شد."); }} />
      <ReasonDialog open={action === "end"} onClose={() => setAction(null)} title="پایان عضویت" description="مثلاً فارغ‌التحصیلی یا پایان همکاری. این اقدام برگشت‌پذیر نیست." submitLabel="پایان عضویت" onConfirm={async (reason) => { await post("end", { reason }); done("عضویت پایان یافت."); }} />
    </>
  );
}

function Documents({ files }: { files: FileInfo[] }) {
  const slug = useSlug();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // previews open in a new tab; the tab is opened synchronously so popup blockers allow it
  const open = async (f: FileInfo, inline: boolean) => {
    setError(null);
    setBusy(f.id + (inline ? ":v" : ":d"));
    const win = inline ? window.open("about:blank", "_blank", "noopener=no") : null;
    try {
      const { url } = await api<{ url: string }>(`/v1/files/${f.id}/download-link`, { method: "POST", tenant: slug, body: { inline } });
      if (win) {
        win.opener = null;
        win.location.href = `/api/proxy${url}`;
      } else window.location.assign(`/api/proxy${url}`);
    } catch (e) {
      win?.close();
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const previewable = (f: FileInfo) => f.mimeType === "application/pdf" || f.mimeType.startsWith("image/");
  return (
    <Card title="مدارک">
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">مدرکی پیوست نشده یا اجازه مشاهده مدارک محرمانه را ندارید.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => {
            const ready = f.scanStatus === "clean" || f.scanStatus === "skipped";
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
                {ready ? <FileText aria-hidden className="size-4 text-muted-foreground" /> : <FileWarning aria-hidden className="size-4 text-warning" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.originalName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmtBytes(f.sizeBytes)}
                    {!ready && ` · ${f.scanStatus === "pending" ? "در حال بررسی امنیتی" : "در قرنطینه"}`}
                  </span>
                </span>
                {previewable(f) && (
                  <Button size="sm" variant="secondary" disabled={!ready} loading={busy === f.id + ":v"} onClick={() => open(f, true)}>
                    <Eye aria-hidden className="size-4" />
                    مشاهده
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={!ready} loading={busy === f.id + ":d"} onClick={() => open(f, false)} aria-label={`دانلود ${f.originalName}`}>
                  <Download aria-hidden className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">هر مشاهده یا دانلود مدرک محرمانه در ممیزی ثبت می‌شود.</p>
    </Card>
  );
}

function RejectDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (b: { reason: string; internalNote?: string }) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <FormDialog open={open} onClose={onClose} title="رد درخواست" submitLabel="رد" danger onSubmit={() => onSubmit({ reason: reason.trim(), internalNote: note.trim() || undefined })}>
      <Field label="دلیل رد (به متقاضی نمایش داده می‌شود)" required>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}</Field>
      <Field label="یادداشت داخلی" hint="فقط کارشناسان می‌بینند.">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}</Field>
    </FormDialog>
  );
}

function RevisionDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (b: { reason: string; fields: string[]; deadlineDays: number; internalNote?: string }) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [days, setDays] = useState("7");
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="درخواست اصلاح"
      submitLabel="ارسال برای اصلاح"
      onSubmit={async () => {
        if (!fields.length) throw new Error("حداقل یک مورد برای اصلاح انتخاب کنید.");
        await onSubmit({ reason: reason.trim(), fields, deadlineDays: Number(days) });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">موارد قابل اصلاح</legend>
        {Object.entries(REVISABLE_FIELDS).map(([k, label]) => (
          <Checkbox key={k} label={label} checked={fields.includes(k)} onChange={(e) => setFields((s) => (e.target.checked ? [...s, k] : s.filter((x) => x !== k)))} />
        ))}
      </fieldset>
      <Field label="توضیح برای متقاضی" required>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}</Field>
      <Field label="مهلت (روز)" required>{(p) => <Input {...p} type="number" min={1} max={60} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function TransferDialog({ open, onClose, currentUnitId, onSubmit }: { open: boolean; onClose: () => void; currentUnitId: string | null; onSubmit: (b: { unitId: string; reason: string }) => Promise<void> }) {
  const slug = useSlug();
  const { flat } = useUnits(slug);
  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("");
  return (
    <FormDialog open={open} onClose={onClose} title="انتقال به واحد دیگر" submitLabel="انتقال" onSubmit={() => onSubmit({ unitId, reason: reason.trim() })}>
      <Field label="واحد مقصد" required>
        {(p) => (
          <Select {...p} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="" disabled>انتخاب کنید</option>
            {flat.filter((u) => u.id !== currentUnitId).map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="دلیل" required>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </FormDialog>
  );
}
