"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { fmtDate, fmtDateTime } from "@uni/shared/format";
import { MEMBERSHIP_EVENT, MEMBERSHIP_KIND, MEMBERSHIP_STATUS, REVISABLE_FIELDS } from "@uni/shared/labels";
import type { FileInfo, MembershipKind, MembershipStatus } from "@uni/shared/types";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { Field, Input } from "@uni/shared/ui/field";
import { ErrorState, Loading } from "@uni/shared/ui/states";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { DocumentUpload, EMPTY_PROFILE, ProfileFields, UnitPicker, profilePayload, type Kind, type ProfileValues, type Uploaded } from "@/components/registration/fields";
import { usePublicUnits, useTenantSlug } from "@/lib/tenant";

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
  const q = useQuery({
    queryKey: ["my-application", slug],
    queryFn: () => api<MyApplication>("/v1/me/membership", { tenant: slug }).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="mb-2 text-xl font-bold">درخواست عضویت</h1>
        <p className="mb-6 text-sm text-muted-foreground">حساب شما در سامانه وجود دارد ولی هنوز در این دانشگاه عضو نیستید.</p>
        <ApplyForm />
      </div>
    );
  }
  const m = q.data;
  const st = MEMBERSHIP_STATUS[m.status];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {sp.get("registered") && m.status === "pending_review" && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-3 text-sm text-success">
          <CheckCircle2 aria-hidden className="size-5" />
          درخواست شما ثبت شد. نتیجه بررسی با پیامک اطلاع داده می‌شود.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">وضعیت عضویت</h1>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-sm text-muted-foreground">{MEMBERSHIP_KIND[m.kind]}</span>
      </div>
      <Progress status={m.status} />

      {m.status === "needs_revision" && <RevisionForm m={m} />}
      {m.status === "rejected" && (
        <section className="flex flex-col gap-4">
          <p className="rounded-md bg-danger-bg px-3 py-3 text-sm text-danger">
            <span className="font-medium">دلیل رد: </span>
            {m.decisionReason}
          </p>
          <h2 className="font-semibold">ثبت درخواست جدید</h2>
          <ApplyForm initialKind={m.kind === "faculty" ? "faculty" : "student"} />
        </section>
      )}
      {m.status === "active" && (
        <p className="rounded-md bg-success-bg px-3 py-3 text-sm text-success">عضویت شما فعال است. خدمات پایان‌نامه، مقاله و رویدادها در فازهای بعدی در همین بخش در دسترس خواهد بود.</p>
      )}
      {m.status === "suspended" && <p className="rounded-md bg-warning-bg px-3 py-3 text-sm text-warning">عضویت شما موقتاً معلق شده است. برای پیگیری با واحد مربوطه تماس بگیرید.</p>}

      <section aria-labelledby="history" className="rounded-lg border border-border bg-card p-4">
        <h2 id="history" className="mb-3 font-semibold">تاریخچه</h2>
        <ol className="flex flex-col gap-3">
          {m.history.map((e, i) => (
            <li key={i} className="border-s-2 border-border ps-3">
              <p className="text-sm font-medium">{MEMBERSHIP_EVENT[e.type] ?? e.type}</p>
              <p className="text-xs text-muted-foreground tabular">{fmtDateTime(e.occurredAt)}</p>
              {e.publicNote && <p className="mt-1 text-sm">{e.publicNote}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** THS-06/UX-11 style stepper: where the request is and what happens next. */
function Progress({ status }: { status: MembershipStatus }) {
  const steps = [
    { label: "ثبت درخواست", state: "done" as const },
    { label: status === "needs_revision" ? "اصلاح توسط شما" : "بررسی کارشناس", state: status === "pending_review" || status === "needs_revision" ? ("current" as const) : ("done" as const) },
    {
      label: status === "rejected" ? "رد شد" : "نتیجه",
      state: status === "active" ? ("done" as const) : status === "rejected" ? ("failed" as const) : ("todo" as const),
    },
  ];
  const icon = { done: CheckCircle2, current: Clock, todo: Circle, failed: XCircle };
  const color = { done: "text-success", current: "text-primary", todo: "text-muted-foreground", failed: "text-danger" };
  return (
    <ol className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-4">
      {steps.map((s) => {
        const Icon = icon[s.state];
        return (
          <li key={s.label} aria-current={s.state === "current" ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
            <Icon aria-hidden className={`size-6 ${color[s.state]}`} />
            <span className={`text-xs sm:text-sm ${s.state === "current" ? "font-semibold" : ""}`}>{s.label}</span>
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
    <section aria-labelledby="revision" className="rounded-lg border border-warning/50 bg-warning-bg/40 p-4">
      <h2 id="revision" className="font-semibold">اصلاح درخواست</h2>
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
