"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Copy, Link2, ShieldCheck, UserPlus, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { fmtDate, fmtDateTime, toFaDigits } from "@uni/shared/format";
import { COI, DEGREE, PAPER_EVENT, PAPER_STATUS, RECOMMENDATION, REVIEW_MODE, REVIEW_STATUS, SCORE_CRITERIA } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { AttachmentList, Timeline } from "@uni/shared/ui/case";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { Card, Dl, PageHeader } from "@uni/shared/ui/layout";
import { QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { CaseAttachment, FileRef, ManagerPaper, ManagerReview, ReviewerCandidate } from "@uni/shared/types";
import { useCan, useSlug } from "@/lib/hooks";

const att = (f: FileRef, field: string): CaseAttachment => ({ ...f, createdAt: "", field });

export default function ManagerPaperPage() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["paper-admin", slug, id], queryFn: () => api<ManagerPaper>(`/v1/admin/papers/${id}`, { tenant: slug }) });
  return (
    <>
      <Link href={`/t/${slug}/papers`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        مقالات
      </Link>
      <QueryView query={q}>{(p) => <Detail p={p} />}</QueryView>
    </>
  );
}

function Detail({ p }: { p: ManagerPaper }) {
  const slug = useSlug();
  const can = useCan(slug);
  const st = PAPER_STATUS[p.status];
  const current = p.reviews.filter((r) => r.round === p.round && r.status !== "cancelled");
  const rounds = [...new Set(p.reviews.map((r) => r.round))].sort((a, b) => b - a);
  const reviewing = ["under_review", "revised", "reviews_done"].includes(p.status);
  return (
    <>
      <PageHeader eyebrow={`${p.trackingCode} · ${p.trackName} · داوری ${REVIEW_MODE[p.reviewMode].label}`} title={p.title} actions={<Badge tone={st.tone}>{st.label}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {(p.status === "submitted" || p.status === "revised") && can("paper.screen") && <Screening p={p} />}
          {reviewing && can("paper.assign_reviewer") && <Reviewers p={p} current={current} />}
          {(p.status === "under_review" || p.status === "reviews_done") && can("paper.decide") && <DecisionPanel p={p} submitted={current.filter((r) => r.status === "submitted").length} />}

          {rounds.map((round) => (
            <Card key={round} title={`نظر داوران — دور ${toFaDigits(String(round))}`}>
              <ul className="flex flex-col gap-4">
                {p.reviews
                  .filter((r) => r.round === round && r.status === "submitted")
                  .map((r) => (
                    <li key={r.id} className="rounded-2xl border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {r.alias} <span className="text-sm font-normal text-muted-foreground">— {r.reviewer.fullName}{r.reviewer.type === "guest" ? " (مهمان)" : ""}</span>
                        </p>
                        {r.recommendation && <Badge tone={RECOMMENDATION[r.recommendation].tone}>{RECOMMENDATION[r.recommendation].label}</Badge>}
                      </div>
                      <p className="mt-3 text-sm leading-7 whitespace-pre-line">{r.commentsToAuthor}</p>
                      {r.confidentialComments && (
                        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-2 text-sm">
                          <span className="font-semibold">محرمانه: </span>
                          {r.confidentialComments}
                        </p>
                      )}
                      {Object.keys(r.scores).length > 0 && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {SCORE_CRITERIA.filter((c) => c.key in r.scores)
                            .map((c) => `${c.label}: ${toFaDigits(String(r.scores[c.key]))}`)
                            .join(" · ")}
                        </p>
                      )}
                      {r.attachment && (
                        <div className="mt-3">
                          <AttachmentList tenant={slug} items={[att(r.attachment, "a")]} labels={{ a: "پیوست داور" }} />
                        </div>
                      )}
                    </li>
                  ))}
                {!p.reviews.some((r) => r.round === round && r.status === "submitted") && <li className="text-sm text-muted-foreground">هنوز نظری ثبت نشده است.</li>}
              </ul>
            </Card>
          ))}

          <Card title="نسخه‌های مقاله">
            <ul className="flex flex-col gap-4">
              {p.versions.map((v) => {
                const report = v.scrubReport as { error?: string; cleared?: string[]; anonymisedParts?: string[] };
                return (
                  <li key={v.round} className="flex flex-col gap-2">
                    <p className="text-sm font-semibold">دور {toFaDigits(String(v.round))}</p>
                    <AttachmentList
                      tenant={slug}
                      items={[...(v.original ? [att(v.original, "o")] : []), ...(v.reviewCopy ? [att(v.reviewCopy, "c")] : []), ...(v.responseFile ? [att(v.responseFile, "r")] : [])]}
                      labels={{ o: "نسخه اصلی نویسنده", c: "نسخه داوری (پاک‌سازی‌شده)", r: "پاسخ نویسنده" }}
                    />
                    {report.error ? (
                      <p className="flex items-start gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger">
                        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                        پاک‌سازی فراداده ممکن نشد (احتمالاً فایل رمزدار است)؛ در داوری دوسوکور فایلی به داور نمی‌رسد تا نسخه مناسب دریافت شود.
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck aria-hidden className="size-4 text-success" />
                        فراداده پاک شد{report.cleared?.length ? `: ${report.cleared.join("، ")}` : ""}
                      </p>
                    )}
                    {v.responseLetter && <p className="rounded-xl bg-muted px-3 py-2 text-sm leading-7 whitespace-pre-line">{v.responseLetter}</p>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="مشخصات">
            <Dl
              items={[
                ["نویسنده", `${p.author.fullName ?? "—"}${p.author.memberNo ? ` (${toFaDigits(p.author.memberNo)})` : ""}`],
                ["نویسندگان همکار", p.coAuthors.length ? p.coAuthors.map((c) => c.fullName).join("، ") : "—"],
                ["مقطع", DEGREE[p.degree] ?? p.degree],
                ["حوزه", p.field ?? "—"],
                ["ارسال", fmtDate(p.submittedAt)],
                ["دور جاری", `${toFaDigits(String(p.round))} از ${toFaDigits(String(p.track.maxRounds))}`],
              ]}
            />
            {p.conflicts.note && (
              <p className="mt-4 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning">
                <span className="font-semibold">اظهار تضاد منافع نویسنده: </span>
                {p.conflicts.note}
              </p>
            )}
            {p.abstract && <p className="mt-4 text-sm leading-7 whitespace-pre-line">{p.abstract}</p>}
          </Card>
          <Card title="تاریخچه">
            <Timeline
              items={p.history.map((e, i) => ({
                key: String(i),
                title: PAPER_EVENT[e.type] ?? e.type,
                at: e.occurredAt,
                tone: e.type.includes("reject") || e.type === "withdrawn" ? "danger" : e.type.includes("revision") || e.type.includes("declined") ? "warning" : e.type === "decided" ? "success" : "info",
                meta: [e.actorName, e.audience === "managers" ? "فقط مدیران" : null].filter(Boolean).join(" · "),
                children: e.note ? <p className="rounded-lg bg-muted px-3 py-2">{e.note}</p> : undefined,
              }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function useRefresh(id: string) {
  const slug = useSlug();
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["paper-admin", slug, id] });
    qc.invalidateQueries({ queryKey: ["papers", slug] });
  };
}

/** PAP-02: initial screening. */
function Screening({ p }: { p: ManagerPaper }) {
  const slug = useSlug();
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [dialog, setDialog] = useState<"request_fix" | "reject" | null>(null);
  const [days, setDays] = useState("14");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const screen = async (decision: string, body: Record<string, unknown> = {}) => {
    await api(`/v1/admin/papers/${p.id}/screen`, { method: "POST", tenant: slug, body: { decision, ...body } });
    refresh();
  };
  return (
    <section aria-label="بررسی اولیه" className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-5">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-primary to-gold" />
      <p className="text-xs font-semibold text-gold">{p.status === "revised" ? "نسخه اصلاح‌شده رسید" : "بررسی اولیه"}</p>
      <h2 className="mt-1 font-bold">{p.status === "revised" ? "داوران دور بعد را انتخاب کنید یا مستقیم تصمیم بگیرید" : "کامل بودن و آمادگی برای داوری"}</h2>
      {p.status === "submitted" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                await screen("send_to_review");
                toast("مقاله به داوری ارجاع شد؛ داوران را دعوت کنید.");
              } catch (e) {
                toast(errorMessage(e));
              } finally {
                setPending(false);
              }
            }}
          >
            ارجاع به داوری
          </Button>
          <Button variant="secondary" onClick={() => (setNote(""), setDialog("request_fix"))}>درخواست اصلاح اولیه</Button>
          <Button variant="danger" onClick={() => setDialog("reject")}>رد</Button>
        </div>
      )}
      <FormDialog
        open={dialog === "request_fix"}
        onClose={() => setDialog(null)}
        title="درخواست اصلاح اولیه"
        submitLabel="ارسال برای نویسنده"
        onSubmit={async () => {
          await screen("request_fix", { revisionDays: Number(days) || 14, note: note.trim() || undefined });
          toast("درخواست اصلاح برای نویسنده فرستاده شد.");
        }}
      >
        <Field label="آنچه باید اصلاح شود" required>
          {(f) => <Textarea {...f} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <Field label="مهلت (روز)">{(f) => <Input {...f} type="number" dir="ltr" min={1} max={120} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
      </FormDialog>
      <ReasonDialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="رد مقاله در بررسی اولیه"
        description="دلیل به نویسنده نمایش داده می‌شود."
        submitLabel="رد مقاله"
        onConfirm={async (reason) => {
          await screen("reject", { note: reason });
          toast("مقاله رد شد.");
        }}
      />
    </section>
  );
}

/** PAP-03/04/11/14: current round invitations, member and guest. */
function Reviewers({ p, current }: { p: ManagerPaper; current: ManagerReview[] }) {
  const slug = useSlug();
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [assigning, setAssigning] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [cancel, setCancel] = useState<ManagerReview | null>(null);
  const [revoke, setRevoke] = useState<ManagerReview | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const active = current.filter((r) => r.status !== "declined").length;
  return (
    <Card
      title={`داوران دور ${toFaDigits(String(p.round))}`}
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setInviting(true)}>
            <UserRoundPlus aria-hidden className="size-4" />
            داور مهمان
          </Button>
          <Button size="sm" onClick={() => setAssigning(true)}>
            <UserPlus aria-hidden className="size-4" />
            دعوت داور
          </Button>
        </div>
      }
    >
      {active < p.track.minReviewers && (
        <p className="mb-3 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning">
          این روند دست‌کم {toFaDigits(String(p.track.minReviewers))} داور می‌خواهد؛ اکنون {toFaDigits(String(active))} داور فعال است.
        </p>
      )}
      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">هنوز داوری دعوت نشده است.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {current.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.reviewer.fullName} <span className="text-muted-foreground">· {r.alias}{r.reviewer.type === "guest" ? " · مهمان" : ""}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  مهلت {fmtDate(r.dueAt)}
                  {r.declineReason && ` · دلیل رد: ${r.declineReason}`}
                  {r.conflictsAcknowledged?.length ? ` · تضاد منافع تأییدشده: ${r.conflictsAcknowledged.map((c) => COI[c] ?? c).join("، ")}` : ""}
                </p>
              </div>
              <Badge tone={REVIEW_STATUS[r.status].tone}>{REVIEW_STATUS[r.status].label}</Badge>
              {r.reviewer.type === "guest" && !r.reviewer.revoked && r.reviewer.guestId && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const res = await api<{ inviteUrl: string }>(`/v1/admin/paper-guests/${(r.reviewer as { guestId: string }).guestId}/reissue`, { method: "POST", tenant: slug });
                        setLink(res.inviteUrl);
                      } catch (e) {
                        toast(errorMessage(e));
                      }
                    }}
                  >
                    <Link2 aria-hidden className="size-4" />
                    لینک تازه
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoke(r)}>لغو دسترسی</Button>
                </>
              )}
              {(r.status === "invited" || r.status === "accepted") && (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setCancel(r)}>لغو دعوت</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AssignDialog open={assigning} onClose={() => setAssigning(false)} p={p} onDone={refresh} />
      <GuestDialog open={inviting} onClose={() => setInviting(false)} p={p} onDone={(url) => (refresh(), setLink(url))} />
      <ReasonDialog
        open={!!cancel}
        onClose={() => setCancel(null)}
        title="لغو دعوت داوری"
        submitLabel="لغو دعوت"
        onConfirm={async (reason) => {
          await api(`/v1/admin/paper-reviews/${cancel!.id}/cancel`, { method: "POST", tenant: slug, body: { reason } });
          refresh();
        }}
      />
      <ReasonDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title="لغو دسترسی داور مهمان"
        description="لینک و نشست داور فوراً از کار می‌افتد."
        submitLabel="لغو دسترسی"
        onConfirm={async (reason) => {
          await api(`/v1/admin/paper-guests/${(revoke!.reviewer as { guestId: string }).guestId}/revoke`, { method: "POST", tenant: slug, body: { reason } });
          refresh();
        }}
      />
      {link && <InviteLink url={link} onClose={() => setLink(null)} />}
    </Card>
  );
}

function InviteLink({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="mt-4 rounded-xl border border-primary/30 bg-info-bg p-4">
      <p className="text-sm font-semibold">لینک یک‌بارمصرف داور مهمان</p>
      <p className="mt-1 text-xs text-muted-foreground">این لینک فقط یک بار باز می‌شود و جایی ذخیره نمی‌شود؛ اکنون آن را برای داور بفرستید.</p>
      <div className="mt-3 flex gap-2">
        <Input readOnly dir="ltr" value={url} aria-label="لینک دعوت" onFocus={(e) => e.target.select()} />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(url).catch(() => undefined);
            setCopied(true);
          }}
        >
          <Copy aria-hidden className="size-4" />
          {copied ? "کپی شد" : "کپی"}
        </Button>
        <Button variant="ghost" onClick={onClose}>بستن</Button>
      </div>
    </div>
  );
}

function AssignDialog({ open, onClose, p, onDone }: { open: boolean; onClose: () => void; p: ManagerPaper; onDone: () => void }) {
  const slug = useSlug();
  const toast = useToast();
  const cands = useQuery({
    queryKey: ["reviewer-candidates", slug, p.id],
    enabled: open,
    queryFn: () => api<ReviewerCandidate[]>(`/v1/admin/papers/${p.id}/reviewer-candidates`, { tenant: slug }),
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState(String(p.track.reviewerDays));
  const [ack, setAck] = useState(false);
  const taken = new Set(p.reviews.filter((r) => r.round === p.round && r.status !== "cancelled" && r.status !== "declined" && r.reviewer.type === "member").map((r) => (r.reviewer as { membershipId: string }).membershipId));
  const conflicted = (cands.data ?? []).filter((c) => picked.includes(c.membership_id) && c.conflicts.length);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      wide
      title="دعوت از داوران"
      submitLabel={`دعوت ${picked.length ? toFaDigits(String(picked.length)) : ""} داور`}
      onSubmit={async () => {
        if (!picked.length) throw new Error("دست‌کم یک داور انتخاب کنید.");
        await api(`/v1/admin/papers/${p.id}/reviewers`, {
          method: "POST",
          tenant: slug,
          body: { reviewers: picked.map((m) => ({ membershipId: m, dueDays: Number(days) || undefined })), acknowledgeConflicts: ack },
        });
        setPicked([]);
        setAck(false);
        onDone();
        toast("دعوت داوری فرستاده شد.");
      }}
    >
      <Field label="مهلت داوری (روز)" className="max-w-40">
        {(f) => <Input {...f} type="number" dir="ltr" min={1} max={120} value={days} onChange={(e) => setDays(e.target.value)} />}
      </Field>
      <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {cands.data?.map((c) => {
          const hard = c.conflicts.includes("author") || c.conflicts.includes("co_author");
          const already = taken.has(c.membership_id);
          return (
            <li key={c.membership_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <Checkbox
                label={c.full_name}
                description={[c.unit_name, `${toFaDigits(String(c.active))} داوری فعال`, `${toFaDigits(String(c.done))} داوری انجام‌شده`].filter(Boolean).join(" · ")}
                disabled={hard || already}
                checked={picked.includes(c.membership_id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, c.membership_id] : picked.filter((x) => x !== c.membership_id))}
              />
              <span className="ms-auto flex flex-wrap gap-1">
                {already && <Badge tone="info">دعوت‌شده</Badge>}
                {c.conflicts.map((x) => (
                  <Badge key={x} tone={x === "author" || x === "co_author" ? "danger" : "warning"}>{COI[x] ?? x}</Badge>
                ))}
              </span>
            </li>
          );
        })}
        {cands.data?.length === 0 && <li className="text-sm text-muted-foreground">عضوی با نقش داور پیدا نشد؛ ابتدا نقش «داور» را به افراد بدهید یا داور مهمان دعوت کنید.</li>}
      </ul>
      {conflicted.length > 0 && (
        <div className="rounded-xl bg-warning-bg p-3 text-sm text-warning">
          <p className="mb-2">برای {conflicted.map((c) => c.full_name).join("، ")} تضاد منافع احتمالی وجود دارد.</p>
          <Checkbox label="بررسی کردم و دعوت را تأیید می‌کنم (در ممیزی ثبت می‌شود)" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        </div>
      )}
    </FormDialog>
  );
}

function GuestDialog({ open, onClose, p, onDone }: { open: boolean; onClose: () => void; p: ManagerPaper; onDone: (url: string) => void }) {
  const slug = useSlug();
  const [v, setV] = useState({ fullName: "", mobile: "", email: "", dueDays: String(p.track.reviewerDays), expiresDays: "" });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="دعوت داور مهمان"
      submitLabel="ساخت لینک دعوت"
      onSubmit={async () => {
        const r = await api<{ inviteUrl: string }>(`/v1/admin/papers/${p.id}/guest-reviewers`, {
          method: "POST",
          tenant: slug,
          body: {
            fullName: v.fullName.trim(),
            mobile: v.mobile.trim() || undefined,
            email: v.email.trim() || undefined,
            dueDays: Number(v.dueDays) || undefined,
            expiresDays: Number(v.expiresDays) || undefined,
          },
        });
        setV({ ...v, fullName: "", mobile: "", email: "" });
        onDone(r.inviteUrl);
      }}
    >
      <p className="text-sm text-muted-foreground">داور مهمان حساب کاربری نمی‌سازد و فقط همین مقاله را می‌بیند. اگر موبایل وارد کنید، لینک پیامک می‌شود.</p>
      <Field label="نام" required>{(f) => <Input {...f} value={v.fullName} maxLength={120} onChange={(e) => setV({ ...v, fullName: e.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="موبایل">{(f) => <Input {...f} dir="ltr" inputMode="tel" value={v.mobile} onChange={(e) => setV({ ...v, mobile: e.target.value })} />}</Field>
        <Field label="ایمیل">{(f) => <Input {...f} dir="ltr" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="مهلت داوری (روز)">{(f) => <Input {...f} type="number" dir="ltr" min={1} max={120} value={v.dueDays} onChange={(e) => setV({ ...v, dueDays: e.target.value })} />}</Field>
        <Field label="اعتبار دسترسی (روز)" hint="پیش‌فرض: مهلت + ۳۰ روز">{(f) => <Input {...f} type="number" dir="ltr" min={1} max={365} value={v.expiresDays} onChange={(e) => setV({ ...v, expiresDays: e.target.value })} />}</Field>
      </div>
    </FormDialog>
  );
}

/** PAP-06/07: decision or revision request. */
function DecisionPanel({ p, submitted }: { p: ManagerPaper; submitted: number }) {
  const slug = useSlug();
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("30");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revise = decision === "minor_revision" || decision === "major_revision";
  const lastRound = p.round >= p.track.maxRounds;
  return (
    <Card title="تصمیم">
      <p className="mb-4 text-sm text-muted-foreground">
        {toFaDigits(String(submitted))} نظر در این دور ثبت شده است. نظر داوران توصیه است؛ تصمیم با شماست.
        {lastRound && " این آخرین دور مجاز است و اصلاح دوباره ممکن نیست."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="تصمیم" required>
          {(f) => (
            <Select {...f} value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="">انتخاب کنید</option>
              <option value="accept">پذیرش</option>
              <option value="accept_conditional">پذیرش مشروط</option>
              <option value="minor_revision" disabled={lastRound}>اصلاح جزئی</option>
              <option value="major_revision" disabled={lastRound}>اصلاح اساسی</option>
              <option value="reject">رد</option>
            </Select>
          )}
        </Field>
        {revise && <Field label="مهلت اصلاح (روز)">{(f) => <Input {...f} type="number" dir="ltr" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>}
      </div>
      <Field label="یادداشت برای نویسنده" className="mt-4" hint="جمع‌بندی نظرها؛ نام داوران را ننویسید.">
        {(f) => <Textarea {...f} className="min-h-28" value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <Button
        className="mt-4"
        disabled={!decision}
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await api(`/v1/admin/papers/${p.id}/decision`, { method: "POST", tenant: slug, body: { decision, note: note.trim() || undefined, revisionDays: revise ? Number(days) || 30 : undefined } });
            toast("تصمیم ثبت و به نویسنده اطلاع داده شد.");
            refresh();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setPending(false);
          }
        }}
      >
        ثبت تصمیم
      </Button>
      <p className="mt-2 text-xs text-muted-foreground tabular">آخرین تغییر: {fmtDateTime(p.history.at(-1)?.occurredAt)}</p>
    </Card>
  );
}
