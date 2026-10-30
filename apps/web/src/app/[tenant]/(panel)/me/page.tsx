"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { fmtDate, fmtDateTime, toFaDigits } from "@uni/shared/format";
import { MEMBERSHIP_EVENT, MEMBERSHIP_KIND, MEMBERSHIP_STATUS, REVISABLE_FIELDS } from "@uni/shared/labels";
import type { FileInfo, MembershipKind, MembershipStatus } from "@uni/shared/types";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { DocumentUpload, EMPTY_PROFILE, ProfileFields, UnitPicker, profilePayload, type Kind, type ProfileValues, type Uploaded } from "@/components/registration/fields";
import { HERO_PILL } from "@/components/site/hero-pill";
import { HeroBackdrop } from "@/components/site/sections";
import { usePublicUnits, useSession, useTenantSlug } from "@/lib/tenant";

interface MyApplication {
  id: string;
  kind: MembershipKind;
  status: MembershipStatus;
  memberNo: string | null;
  profile: Record<string, string>;
  unitId: string | null;
  decisionReason: string | null;
  revisionRequest: { fields: string[]; reason: string } | null;
  revisionDeadline: string | null;
  documents: FileInfo[];
  history: { type: string; toStatus: string | null; publicNote: string | null; occurredAt: string }[];
}

function MeInner() {
  const slug = useTenantSlug();
  const sp = useSearchParams();
  const session = useSession();
  const q = useQuery({
    queryKey: ["my-application", slug],
    queryFn: () => api<MyApplication>("/v1/me/membership", { tenant: slug }).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-[2rem] border border-border bg-card p-6 shadow-[0_30px_60px_-30px_rgb(15_23_42/0.35)] sm:p-10">
        <h1 className="text-2xl font-black">درخواست عضویت</h1>
        <p className="mt-2 mb-8 text-sm leading-7 text-muted-foreground">حساب شما در سامانه وجود دارد ولی هنوز در این دانشگاه عضو نیستید. اطلاعات زیر را تکمیل کنید.</p>
        <ApplyForm />
      </div>
    );
  }
  const m = q.data;
  const st = MEMBERSHIP_STATUS[m.status];
  const STATUS_COPY: Partial<Record<MembershipStatus, string>> = {
    pending_review: "درخواست شما در صف بررسی کارشناس دانشگاه است.",
    needs_revision: "کارشناس اصلاح بخشی از اطلاعات را خواسته است؛ تا پایان مهلت آن را ارسال کنید.",
    active: "عضویت شما فعال است و می‌توانید از خدمات دانشگاه استفاده کنید.",
    rejected: "درخواست شما رد شد؛ دلیل آن را ببینید و در صورت امکان دوباره درخواست دهید.",
    suspended: "عضویت شما موقتاً معلق شده است؛ برای پیگیری با واحد مربوطه تماس بگیرید.",
    ended: "عضویت شما به پایان رسیده است.",
  };
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {sp.get("registered") && m.status === "pending_review" && (
        <p role="status" className="enter flex items-center gap-2 rounded-2xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
          <CheckCircle2 aria-hidden className="size-5" />
          درخواست شما ثبت شد. نتیجه بررسی با پیامک اطلاع داده می‌شود.
        </p>
      )}

      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <div className="flex flex-wrap items-center gap-5">
          <span aria-hidden className="flex size-16 items-center justify-center rounded-2xl bg-white/15 text-xl font-black backdrop-blur">
            {(session.data?.fullName ?? "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("\u200c") || "…"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/70">وضعیت عضویت</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">{session.data?.fullName ?? "…"}</h1>
            <p className="mt-1 text-sm text-white/70">
              {MEMBERSHIP_KIND[m.kind]}
              {m.memberNo && <> · <span className="tabular">{toFaDigits(m.memberNo)}</span></>}
            </p>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${HERO_PILL[st.tone]}`}>
            <span aria-hidden className="size-2 rounded-full bg-current" />
            {st.label}
          </span>
        </div>
        <p className="mt-6 max-w-2xl leading-7 text-white/80">{STATUS_COPY[m.status]}</p>
      </section>

      <Progress status={m.status} />

      {m.status === "needs_revision" && <RevisionForm m={m} />}
      {m.status === "rejected" && (
        <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 sm:p-8">
          <p className="rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger">
            <span className="font-semibold">دلیل رد: </span>
            {m.decisionReason}
          </p>
          <h2 className="text-lg font-bold">ثبت درخواست جدید</h2>
          <ApplyForm initialKind={m.kind === "faculty" ? "faculty" : "student"} />
        </section>
      )}

      <section aria-labelledby="history" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <h2 id="history" className="text-lg font-bold">تاریخچه درخواست</h2>
        <ol className="relative mt-6 space-y-6">
          <span aria-hidden className="absolute top-2 bottom-2 start-[11px] w-px bg-border" />
          {[...m.history].reverse().map((e, i) => (
            <li key={i} className="relative flex gap-4">
              <span aria-hidden className={`relative z-10 mt-1 flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-card ${i === 0 ? "bg-primary text-on-primary" : "bg-muted text-muted-foreground"}`}>
                <span className="size-2 rounded-full bg-current" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{MEMBERSHIP_EVENT[e.type] ?? e.type}</p>
                  <p className="text-xs text-muted-foreground tabular">{fmtDateTime(e.occurredAt)}</p>
                </div>
                {e.publicNote && <p className="mt-1.5 rounded-xl bg-muted/60 px-3 py-2 text-sm leading-6">{e.publicNote}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}


/** THS-06/UX-11 stepper: where the request is and what happens next. */
function Progress({ status }: { status: MembershipStatus }) {
  const steps = [
    { label: "ثبت درخواست", hint: "اطلاعات و مدارک ارسال شد", state: "done" as const },
    {
      label: status === "needs_revision" ? "اصلاح توسط شما" : "بررسی کارشناس",
      hint: status === "needs_revision" ? "منتظر ارسال اصلاحیه" : "بررسی مدارک و اطلاعات",
      state: status === "pending_review" || status === "needs_revision" ? ("current" as const) : ("done" as const),
    },
    {
      label: status === "rejected" ? "رد درخواست" : "فعال‌شدن عضویت",
      hint: status === "rejected" ? "دلیل در پایین آمده است" : "دسترسی به خدمات دانشگاه",
      state: status === "active" ? ("done" as const) : status === "rejected" ? ("failed" as const) : ("todo" as const),
    },
  ];
  const dot = {
    done: "bg-success text-white",
    current: "bg-primary text-on-primary shadow-[0_0_0_6px_color-mix(in_oklab,var(--primary)_18%,transparent)]",
    todo: "border-2 border-border bg-card text-muted-foreground",
    failed: "bg-danger text-white",
  };
  const icon = { done: CheckCircle2, current: Clock, todo: Circle, failed: XCircle };
  return (
    <ol className="grid grid-cols-3 rounded-3xl border border-border bg-card px-4 py-6 sm:px-8">
      {steps.map((s, i) => {
        const Icon = icon[s.state];
        return (
          <li key={s.label} aria-current={s.state === "current" ? "step" : undefined} className="relative flex flex-col items-center gap-2 text-center">
            {i < steps.length - 1 && (
              <span aria-hidden className={`absolute top-5 start-1/2 h-0.5 w-full ${s.state === "done" ? "bg-success/60" : "bg-border"}`} />
            )}
            <span className={`relative z-10 flex size-10 items-center justify-center rounded-full ${dot[s.state]}`}>
              <Icon aria-hidden className="size-5" />
            </span>
            <span className={`text-sm ${s.state === "current" ? "font-bold" : "font-medium"}`}>{s.label}</span>
            <span className="hidden text-xs text-muted-foreground sm:block">{s.hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RevisionForm({ m }: { m: MyApplication }) {
  const slug = useTenantSlug();
  const qc = useQueryClient();
  const units = usePublicUnits(slug);
  const fields = new Set(m.revisionRequest?.fields ?? []);
  const kind: Kind = m.kind === "faculty" ? "faculty" : "student";
  const [fullName, setFullName] = useState("");
  const [memberNo, setMemberNo] = useState(m.memberNo ?? "");
  const [unit, setUnit] = useState({ facultyId: "", subUnitId: "" });
  const [profile, setProfile] = useState<ProfileValues>({ ...EMPTY_PROFILE, ...m.profile });
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/v1/me/membership", {
        method: "PATCH",
        tenant: slug,
        body: {
          fullName: fields.has("fullName") ? fullName : undefined,
          memberNo: fields.has("memberNo") ? memberNo : undefined,
          unitId: fields.has("unitId") ? unit.subUnitId || unit.facultyId : undefined,
          profile: fields.has("profile") ? profilePayload(kind, profile) : undefined,
          documentFileIds: fields.has("documents") ? files.map((f) => f.id) : undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ["my-application", slug] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="revision" className="rounded-3xl border border-warning/40 bg-card p-6 shadow-[inset_4px_0_0_var(--warning)] sm:p-8">
      <h2 id="revision" className="text-lg font-bold">اصلاح درخواست</h2>
      <p className="mt-2 text-sm">{m.revisionRequest?.reason}</p>
      <p className="mt-1 text-sm text-muted-foreground tabular">مهلت اصلاح: {fmtDate(m.revisionDeadline)}</p>
      <p className="mt-1 text-sm text-muted-foreground">موارد خواسته‌شده: {[...fields].map((f) => REVISABLE_FIELDS[f] ?? f).join("، ")}</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4" noValidate>
        {fields.has("fullName") && <Field label="نام و نام خانوادگی" required>{(p) => <Input {...p} className="h-11" value={fullName} onChange={(e) => setFullName(e.target.value)} />}</Field>}
        {fields.has("memberNo") && <Field label="شماره دانشجویی/پرسنلی" required>{(p) => <Input {...p} className="h-11" dir="ltr" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} />}</Field>}
        {fields.has("unitId") && units.data && <UnitPicker units={units.data} facultyId={unit.facultyId} subUnitId={unit.subUnitId} onChange={(facultyId, subUnitId) => setUnit({ facultyId, subUnitId })} />}
        {fields.has("profile") && <ProfileFields kind={kind} value={profile} onChange={setProfile} />}
        {fields.has("documents") && <DocumentUpload tenant={slug} files={files} onChange={setFiles} label="مدرک جدید" />}
        {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" loading={pending}>ارسال اصلاحیه</Button>
      </form>
    </section>
  );
}

/** Signed-in person applying to this university (existing account, or after a rejection). */
function ApplyForm({ initialKind = "student" }: { initialKind?: Kind }) {
  const slug = useTenantSlug();
  const qc = useQueryClient();
  const units = usePublicUnits(slug);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [unit, setUnit] = useState({ facultyId: "", subUnitId: "" });
  const [memberNo, setMemberNo] = useState("");
  const [profile, setProfile] = useState<ProfileValues>(EMPTY_PROFILE);
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!unit.facultyId || !memberNo.trim() || files.length === 0) {
      setError("دانشکده، شماره دانشجویی/پرسنلی و حداقل یک مدرک لازم است.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api("/v1/memberships/apply", {
        method: "POST",
        tenant: slug,
        body: {
          kind,
          unitId: unit.subUnitId || unit.facultyId,
          extraUnitIds: unit.subUnitId ? [unit.facultyId] : undefined,
          memberNo: memberNo.trim(),
          profile: profilePayload(kind, profile),
          documentFileIds: files.map((f) => f.id),
        },
      });
      await qc.invalidateQueries({ queryKey: ["my-application", slug] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-sm font-medium">نوع عضویت</legend>
        {(["student", "faculty"] as const).map((k) => (
          <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${kind === k ? "border-primary bg-info-bg" : "border-border bg-card"}`}>
            <input type="radio" name="apply-kind" checked={kind === k} onChange={() => setKind(k)} className="size-4 accent-[var(--primary)]" />
            {MEMBERSHIP_KIND[k]}
          </label>
        ))}
      </fieldset>
      {units.data && <UnitPicker units={units.data} facultyId={unit.facultyId} subUnitId={unit.subUnitId} onChange={(facultyId, subUnitId) => setUnit({ facultyId, subUnitId })} />}
      <Field label={kind === "student" ? "شماره دانشجویی" : "شماره پرسنلی"} required>
        {(p) => <Input {...p} className="h-11" dir="ltr" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} />}
      </Field>
      <ProfileFields kind={kind} value={profile} onChange={setProfile} />
      <DocumentUpload tenant={slug} files={files} onChange={setFiles} label="مدرک عضویت" />
      {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={pending}>ثبت درخواست</Button>
    </form>
  );
}

export default function MePage() {
  return (
    <Suspense>
      <MeInner />
    </Suspense>
  );
}
