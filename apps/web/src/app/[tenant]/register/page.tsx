"use client";

import { api, ApiError, errorMessage } from "@uni/shared/api";
import { toFaDigits } from "@uni/shared/format";
import { Button } from "@uni/shared/ui/button";
import { Checkbox, Field, Input } from "@uni/shared/ui/field";
import { Loading } from "@uni/shared/ui/states";
import { CheckCircle2, GraduationCap, Presentation } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MobileOtp } from "@uni/shared/ui/mobile-otp";
import { AuthFrame, StepRail } from "@/components/site/auth-frame";
import { DocumentUpload, EMPTY_PROFILE, ProfileFields, Steps, UnitPicker, profilePayload, type Kind, type ProfileValues, type Uploaded } from "@/components/registration/fields";
import { usePublicUnits, useTenantSlug } from "@/lib/tenant";

const STEPS = ["دانشکده", "اطلاعات", "موبایل", "مدارک", "رمز عبور"];
const RAIL = [
  { title: "دانشکده و نوع عضویت", hint: "دانشجو یا استاد، و محل تحصیل یا خدمت" },
  { title: "اطلاعات هویتی", hint: "نام، شماره دانشجویی و اطلاعات تحصیلی" },
  { title: "تأیید موبایل", hint: "کد ۶ رقمی پیامک‌شده" },
  { title: "بارگذاری مدرک", hint: "کارت دانشجویی یا حکم کارگزینی" },
  { title: "رمز عبور", hint: "تعیین رمز و پذیرش شرایط" },
];
const NID_RE = /^\d{10}$/;
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

/** Section 6 registration path: unit → info → mobile OTP → document → submit. */
export default function RegisterPage() {
  const slug = useTenantSlug();
  const router = useRouter();
  const units = usePublicUnits(slug);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>("student");
  const [unit, setUnit] = useState({ facultyId: "", subUnitId: "" });
  const [info, setInfo] = useState({ fullName: "", memberNo: "", nationalId: "", email: "" });
  const [profile, setProfile] = useState<ProfileValues>(EMPTY_PROFILE);
  const [proof, setProof] = useState<{ mobile: string; token: string } | null>(null);
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [password, setPassword] = useState({ value: "", confirm: "" });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<{ message: string; accountExists?: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  // move focus to the step title so screen readers announce the new step
  useEffect(() => heading.current?.focus(), [step]);

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    const err: Record<string, string> = {};
    if (step === 0 && !unit.facultyId) err.facultyId = "دانشکده را انتخاب کنید.";
    if (step === 1) {
      if (info.fullName.trim().length < 3) err.fullName = "نام و نام خانوادگی را کامل وارد کنید.";
      if (!info.memberNo.trim()) err.memberNo = kind === "student" ? "شماره دانشجویی را وارد کنید." : "شماره پرسنلی را وارد کنید.";
      if (info.nationalId && !NID_RE.test(toAscii(info.nationalId))) err.nationalId = "کد ملی باید ۱۰ رقم باشد.";
      if (kind === "student" && !profile.degree) err.profile = "مقطع تحصیلی را انتخاب کنید.";
      if (kind === "faculty" && !profile.academicRank) err.profile = "مرتبه علمی را انتخاب کنید.";
    }
    if (step === 3 && files.length === 0) err.files = "حداقل یک مدرک بارگذاری کنید.";
    setErrors(err);
    if (Object.keys(err).length === 0) setStep((s) => s + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (password.value.length < 8) err.password = "رمز عبور حداقل ۸ کاراکتر باشد.";
    else if (password.value !== password.confirm) err.confirm = "تکرار رمز عبور یکسان نیست.";
    if (!terms) err.terms = "پذیرش شرایط و حریم خصوصی لازم است.";
    setErrors(err);
    if (Object.keys(err).length || !proof) return;
    setPending(true);
    setSubmitError(null);
    try {
      await api("/v1/registrations", {
        method: "POST",
        tenant: slug,
        public: true,
        body: {
          mobileProof: proof.token,
          kind,
          unitId: unit.subUnitId || unit.facultyId,
          extraUnitIds: unit.subUnitId ? [unit.facultyId] : undefined,
          memberNo: info.memberNo.trim(),
          fullName: info.fullName.trim(),
          nationalId: info.nationalId ? toAscii(info.nationalId) : undefined,
          email: info.email.trim() || undefined,
          password: password.value,
          profile: profilePayload(kind, profile),
          documentFileIds: files.map((f) => f.id),
          acceptTerms: true,
        },
      });
      // sign in right away so the applicant lands on their status page
      await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: proof.mobile, password: password.value }) });
      router.replace(`/${slug}/me?registered=1`);
    } catch (e2) {
      const code = e2 instanceof ApiError ? e2.code : "";
      if (code === "PROOF_INVALID") {
        setProof(null);
        setStep(2);
      }
      setSubmitError({ message: errorMessage(e2), accountExists: code === "ACCOUNT_EXISTS" });
    } finally {
      setPending(false);
    }
  };

  if (units.isPending) return <Loading />;

  return (
    <AuthFrame
      wide
      title="ثبت‌نام در سامانه"
      subtitle="کمتر از پنج دقیقه؛ نتیجه بررسی با پیامک اطلاع داده می‌شود."
      aside={
        <>
          <p className="mb-6 text-sm font-semibold text-gold-bright">مراحل ثبت‌نام</p>
          <StepRail steps={RAIL} current={step} />
        </>
      }
    >
      <div className="lg:hidden">
        <Steps steps={STEPS} current={step} />
      </div>
      <div className="mb-6 flex items-baseline justify-between gap-3 border-b border-border pb-4">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-bold outline-none">
          {RAIL[step]!.title}
        </h2>
        <span className="shrink-0 text-sm text-muted-foreground">
          مرحله {toFaDigits(String(step + 1))} از {toFaDigits(String(STEPS.length))}
        </span>
      </div>

      {step === 0 && (
        <form onSubmit={next} className="flex flex-col gap-5" noValidate>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">ثبت‌نام به عنوان</legend>
            <div className="grid grid-cols-2 gap-3">
              {([["student", "دانشجو", GraduationCap], ["faculty", "استاد", Presentation]] as const).map(([k, label, Icon]) => (
                <label key={k} className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 transition-colors ${kind === k ? "border-primary bg-info-bg" : "border-border bg-card hover:border-[color-mix(in_oklab,var(--primary)_35%,var(--border))]"}`}>
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-4 accent-[var(--primary)]" />
                  <Icon aria-hidden className="size-5" />
                  <span className="font-medium">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {units.data && units.data.length > 0 ? (
            <UnitPicker units={units.data} facultyId={unit.facultyId} subUnitId={unit.subUnitId} onChange={(facultyId, subUnitId) => setUnit({ facultyId, subUnitId })} errors={errors} />
          ) : (
            <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">ساختار دانشکده‌های این دانشگاه هنوز تعریف نشده است؛ بعداً تلاش کنید.</p>
          )}
          <Button type="submit" size="lg">ادامه</Button>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={next} className="flex flex-col gap-4" noValidate>
          <Field label="نام و نام خانوادگی" required error={errors.fullName}>
            {(p) => <Input {...p} className="h-11" autoComplete="name" value={info.fullName} onChange={(e) => setInfo({ ...info, fullName: e.target.value })} />}
          </Field>
          <Field label={kind === "student" ? "شماره دانشجویی" : "شماره پرسنلی"} required error={errors.memberNo}>
            {(p) => <Input {...p} className="h-11" dir="ltr" inputMode="numeric" value={info.memberNo} onChange={(e) => setInfo({ ...info, memberNo: e.target.value })} />}
          </Field>
          <Field label="کد ملی" hint="فقط برای بررسی هویت؛ به صورت رمزنگاری‌شده نگهداری می‌شود." error={errors.nationalId}>
            {(p) => <Input {...p} className="h-11" dir="ltr" inputMode="numeric" maxLength={10} value={info.nationalId} onChange={(e) => setInfo({ ...info, nationalId: e.target.value })} />}
          </Field>
          <Field label="ایمیل">
            {(p) => <Input {...p} className="h-11" type="email" dir="ltr" autoComplete="email" value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} />}
          </Field>
          <ProfileFields kind={kind} value={profile} onChange={setProfile} />
          {errors.profile && <p role="alert" className="text-sm text-danger">{errors.profile}</p>}
          <StepNav onBack={() => setStep(0)} />
        </form>
      )}

      {step === 2 &&
        (proof ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-3 text-sm text-success">
              <CheckCircle2 aria-hidden className="size-5" />
              شماره <span dir="ltr">{proof.mobile}</span> تأیید شد.
            </p>
            <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} />
          </div>
        ) : (
          <>
            <MobileOtp
              tenant={slug}
              purpose="register"
              submitLabel="تأیید شماره"
              onCode={async (mobile, code) => {
                const r = await api<{ proof: string }>("/v1/auth/otp/verify", { method: "POST", tenant: slug, public: true, body: { mobile, purpose: "register", code } });
                setProof({ mobile, token: r.proof });
                setStep(3);
              }}
            />
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setStep(1)}>بازگشت</Button>
          </>
        ))}

      {step === 3 && (
        <form onSubmit={next} className="flex flex-col gap-5" noValidate>
          <DocumentUpload tenant={slug} proof={proof?.token} files={files} onChange={setFiles} label={kind === "student" ? "تصویر کارت دانشجویی یا گواهی اشتغال به تحصیل" : "تصویر حکم کارگزینی یا گواهی اشتغال"} error={errors.files} />
          <StepNav onBack={() => setStep(2)} />
        </form>
      )}

      {step === 4 && (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="رمز عبور" required hint="حداقل ۸ کاراکتر؛ از رمزهای ساده و تکراری استفاده نکنید." error={errors.password}>
            {(p) => <Input {...p} className="h-11" type="password" dir="ltr" autoComplete="new-password" value={password.value} onChange={(e) => setPassword({ ...password, value: e.target.value })} />}
          </Field>
          <Field label="تکرار رمز عبور" required error={errors.confirm}>
            {(p) => <Input {...p} className="h-11" type="password" dir="ltr" autoComplete="new-password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} />}
          </Field>
          <Checkbox label="شرایط استفاده و سیاست حریم خصوصی را می‌پذیرم." description="اطلاعات شما فقط برای بررسی عضویت و ارائه خدمات دانشگاه استفاده می‌شود." checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <Link href="/terms" target="_blank" className="-mt-2 ms-6 text-sm text-primary underline">مطالعه متن شرایط و حریم خصوصی</Link>
          {errors.terms && <p role="alert" className="text-sm text-danger">{errors.terms}</p>}
          {submitError && (
            <div role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              <p>{submitError.message}</p>
              {submitError.accountExists && (
                <Link href={`/${slug}/login?next=/${slug}/me`} className="mt-1 inline-block font-medium underline">
                  ورود به حساب موجود
                </Link>
              )}
            </div>
          )}
          <Button type="submit" size="lg" loading={pending}>ثبت درخواست عضویت</Button>
          <Button variant="ghost" onClick={() => setStep(3)} disabled={pending}>بازگشت</Button>
        </form>
      )}

      <p className="mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground">
        قبلاً ثبت‌نام کرده‌اید؟{" "}
        <Link href={`/${slug}/login`} className="text-primary underline">وارد شوید</Link>
      </p>
    </AuthFrame>
  );
}

function StepNav({ onBack, onNext }: { onBack: () => void; onNext?: () => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-3">
      <Button variant="secondary" size="lg" onClick={onBack}>بازگشت</Button>
      {onNext ? <Button size="lg" onClick={onNext}>ادامه</Button> : <Button type="submit" size="lg">ادامه</Button>}
    </div>
  );
}
