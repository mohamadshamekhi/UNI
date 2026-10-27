"use client";

import { CheckCircle2, Download, EyeOff, FileText, Lock, Paperclip, XCircle } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../api";
import { fmtBytes, fmtDate, toFaDigits } from "../format";
import { RECOMMENDATION, REVIEW_MODE, REVIEW_STATUS, SCORE_CRITERIA } from "../labels";
import type { Recommendation, ReviewerPaperView } from "../types";
import { Badge } from "./badge";
import { Button } from "./button";
import { Field, Input, Textarea } from "./field";

export interface ReviewActions {
  accept: () => Promise<unknown>;
  decline: (reason: string) => Promise<unknown>;
  submit: (body: { recommendation: Recommendation; commentsToAuthor: string; confidentialComments?: string; scores?: Record<string, number>; attachmentFileId?: string }) => Promise<unknown>;
  download: () => Promise<unknown>;
  upload?: (file: File) => Promise<{ id: string }>;
}

const SURFACE = "rounded-3xl border border-border bg-card p-6 sm:p-8";

/**
 * Reviewer workspace (PAP-05), shared by member and guest reviewers: the invitation, the
 * manuscript of the round, and the review form. It only shows what the API returned for a reviewer.
 */
export function ReviewWorkspace({ view, actions, onChanged }: { view: ReviewerPaperView; actions: ReviewActions; onChanged: () => void }) {
  const { review: r, paper: p } = view;
  const st = REVIEW_STATUS[r.status];
  return (
    <div className="flex flex-col gap-5">
      <section className={SURFACE}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gold">
              {p.trackName} · دور {toFaDigits(String(r.round))}
            </p>
            <h1 className="mt-1 text-xl font-black sm:text-2xl">{p.title}</h1>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">نقش شما</dt>
            <dd className="mt-0.5 font-medium">{r.alias}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">مهلت</dt>
            <dd className="mt-0.5 font-medium tabular">{r.dueAt ? fmtDate(`${r.dueAt}T12:00:00Z`) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">حالت داوری</dt>
            <dd className="mt-0.5 font-medium">{REVIEW_MODE[p.reviewMode].label}</dd>
          </div>
        </dl>
        {p.author ? (
          <p className="mt-5 text-sm">
            <span className="text-muted-foreground">نویسنده: </span>
            {[p.author.fullName, ...p.author.coAuthors].filter(Boolean).join("، ")}
          </p>
        ) : (
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <EyeOff aria-hidden className="size-4" />
            هویت نویسنده در این داوری پنهان است.
          </p>
        )}
      </section>

      {r.canRespond && <Invitation actions={actions} onChanged={onChanged} />}

      <section className={SURFACE}>
        <h2 className="mb-3 font-bold">چکیده</h2>
        <p className="leading-8 whitespace-pre-line">{p.abstract || "—"}</p>
        {p.keywords.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {p.keywords.map((k) => (
              <li key={k} className="rounded-full bg-muted px-3 py-1 text-xs">{k}</li>
            ))}
          </ul>
        )}
        {view.manuscript && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4">
            <FileText aria-hidden className="size-6 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" dir="ltr">{view.manuscript.name}</p>
              <p className="text-xs text-muted-foreground tabular">{fmtBytes(view.manuscript.sizeBytes)}</p>
            </div>
            {view.manuscript.downloadAllowed ? (
              <DownloadButton ready={view.manuscript.ready} onDownload={actions.download} />
            ) : (
              <span className="text-xs text-muted-foreground">دانلود برای این روند غیرفعال است.</span>
            )}
          </div>
        )}
        {!view.manuscript && r.canRespond && <p className="mt-6 text-sm text-muted-foreground">پس از پذیرش دعوت، فایل مقاله در دسترس قرار می‌گیرد.</p>}
      </section>

      {view.responseLetter && (
        <section className={SURFACE}>
          <h2 className="mb-3 font-bold">پاسخ نویسنده به داوری دور قبل</h2>
          <p className="leading-8 whitespace-pre-line">{view.responseLetter}</p>
        </section>
      )}

      {view.previousRounds.length > 0 && (
        <section className={SURFACE}>
          <h2 className="mb-3 font-bold">نظرهای قبلی شما</h2>
          <ul className="flex flex-col gap-3">
            {view.previousRounds.map((x) => (
              <li key={x.round} className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
                <p className="mb-1 font-semibold">
                  دور {toFaDigits(String(x.round))} {x.recommendation && `· ${RECOMMENDATION[x.recommendation].label}`}
                </p>
                <p className="leading-7 whitespace-pre-line">{x.commentsToAuthor}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.canSubmit && <ReviewForm actions={actions} onChanged={onChanged} />}

      {r.status === "submitted" && (
        <section className={SURFACE}>
          <p className="mb-4 flex items-center gap-2 font-bold text-success">
            <CheckCircle2 aria-hidden className="size-5" />
            نظر شما ثبت شد
          </p>
          {r.recommendation && <Badge tone={RECOMMENDATION[r.recommendation].tone}>{RECOMMENDATION[r.recommendation].label}</Badge>}
          <p className="mt-3 leading-8 whitespace-pre-line">{r.commentsToAuthor}</p>
          {r.confidentialComments && (
            <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm">
              <span className="font-semibold">محرمانه برای مدیر بررسی: </span>
              {r.confidentialComments}
            </p>
          )}
        </section>
      )}
      {r.status === "declined" && <p className="rounded-2xl bg-muted px-4 py-3 text-sm">دعوت را نپذیرفته‌اید. سپاس از پاسخ شما.</p>}
      {p.closed && r.status !== "submitted" && <p className="rounded-2xl bg-muted px-4 py-3 text-sm">رسیدگی به این مقاله پایان یافته است.</p>}
    </div>
  );
}

function DownloadButton({ ready, onDownload }: { ready: boolean; onDownload: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        disabled={!ready}
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await onDownload();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setPending(false);
          }
        }}
      >
        <Download aria-hidden className="size-4" />
        {ready ? "دریافت فایل" : "در حال بررسی امنیتی"}
      </Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function Invitation({ actions, onChanged }: { actions: ReviewActions; onChanged: () => void }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: "accept" | "decline") => {
    setPending(kind);
    setError(null);
    try {
      if (kind === "accept") await actions.accept();
      else await actions.decline(reason.trim());
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };
  return (
    <section aria-labelledby="invite" className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card p-6 sm:p-8">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-primary to-gold" />
      <h2 id="invite" className="font-bold">دعوت به داوری</h2>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">با پذیرش، فایل مقاله برای شما باز می‌شود. اگر با نویسنده یا موضوع تضاد منافع دارید، لطفاً دعوت را نپذیرید.</p>
      {declining && (
        <Field label="دلیل (اختیاری)" className="mt-4">
          {(p) => <Textarea {...p} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        {!declining && (
          <Button loading={pending === "accept"} disabled={pending !== null} onClick={() => run("accept")}>
            <CheckCircle2 aria-hidden className="size-4" />
            می‌پذیرم
          </Button>
        )}
        {declining ? (
          <Button variant="danger" loading={pending === "decline"} disabled={pending !== null} onClick={() => run("decline")}>
            ثبت رد دعوت
          </Button>
        ) : (
          <Button variant="secondary" disabled={pending !== null} onClick={() => setDeclining(true)}>
            <XCircle aria-hidden className="size-4" />
            نمی‌پذیرم
          </Button>
        )}
      </div>
    </section>
  );
}

function ReviewForm({ actions, onChanged }: { actions: ReviewActions; onChanged: () => void }) {
  const [rec, setRec] = useState<Recommendation | "">("");
  const [comments, setComments] = useState("");
  const [confidential, setConfidential] = useState("");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!rec) err.rec = "توصیه خود را انتخاب کنید.";
    if (!comments.trim()) err.comments = "متن نظر برای نویسنده لازم است.";
    setErrors(err);
    if (Object.keys(err).length) return;
    setPending(true);
    setError(null);
    try {
      const s = Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
      await actions.submit({ recommendation: rec as Recommendation, commentsToAuthor: comments.trim(), confidentialComments: confidential.trim() || undefined, scores: s, attachmentFileId: attachment?.id });
      onChanged();
    } catch (e2) {
      setError(errorMessage(e2));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={`${SURFACE} flex flex-col gap-5`}>
      <h2 className="font-bold">ثبت نظر داوری</h2>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">
          توصیه <span className="text-danger" aria-hidden>*</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-5">
          {(Object.keys(RECOMMENDATION) as Recommendation[]).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-info-bg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary">
              <input type="radio" name="rec" className="size-4 accent-[var(--primary)]" checked={rec === k} onChange={() => setRec(k)} />
              {RECOMMENDATION[k].label}
            </label>
          ))}
        </div>
        {errors.rec && <p role="alert" className="mt-1 text-xs text-danger">{errors.rec}</p>}
      </fieldset>
      <Field label="نظر برای نویسنده" required error={errors.comments} hint="بدون نام؛ هر نشانه‌ای که شما را معرفی کند حذف کنید.">
        {(p) => <Textarea {...p} className="min-h-40" value={comments} maxLength={20000} onChange={(e) => setComments(e.target.value)} />}
      </Field>
      <Field label="نظر محرمانه برای مدیر بررسی" hint="به نویسنده نمایش داده نمی‌شود.">
        {(p) => <Textarea {...p} value={confidential} maxLength={10000} onChange={(e) => setConfidential(e.target.value)} />}
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">امتیاز (۰ تا ۱۰، اختیاری)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {SCORE_CRITERIA.map((c) => (
            <Field key={c.key} label={c.label}>
              {(p) => <Input {...p} type="number" dir="ltr" min={0} max={10} value={scores[c.key] ?? ""} onChange={(e) => setScores({ ...scores, [c.key]: e.target.value })} />}
            </Field>
          ))}
        </div>
      </fieldset>
      {actions.upload && (
        <div>
          <input
            ref={fileInput}
            type="file"
            id="review-attachment"
            className="sr-only"
            accept="application/pdf,.docx,image/png,image/jpeg"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              setError(null);
              try {
                const row = await actions.upload!(f);
                setAttachment({ id: row.id, name: f.name });
              } catch (err2) {
                setError(errorMessage(err2));
              } finally {
                setUploading(false);
                if (fileInput.current) fileInput.current.value = "";
              }
            }}
          />
          <label htmlFor="review-attachment" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground hover:border-primary hover:text-primary">
            <Paperclip aria-hidden className="size-4" />
            {uploading ? "در حال بارگذاری…" : attachment ? attachment.name : "پیوست داوری (اختیاری)"}
          </label>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Lock aria-hidden className="size-3" />
            فقط مدیر بررسی پیوست را می‌بیند.
          </p>
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={pending} className="self-start">ثبت نظر</Button>
    </form>
  );
}
