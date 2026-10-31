"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CheckCircle2, Clock, FileText, MapPin, Users, Video, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { fmtDateTime, fmtNum, fmtRial } from "@uni/shared/format";
import { EVENT_STATUS, REGISTRATION_STATUS, REVIEW_MODE } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormFields, type FormValues } from "@uni/shared/ui/form-fields";
import { QueryView } from "@uni/shared/ui/states";
import type { EventDetail } from "@uni/shared/types";
import { useSession, useTenantSlug } from "@/lib/tenant";

/** Event detail and registration (EVT-03/04/05/07). */
export default function EventPage() {
  const slug = useTenantSlug();
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["event", slug, id], queryFn: () => api<EventDetail>(`/v1/events/${id}`, { tenant: slug, public: true }) });
  const [values, setValues] = useState<FormValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const register = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await api<{ paymentId: string | null; status: string }>(`/v1/events/${id}/registrations`, { method: "POST", tenant: slug, body: { answers: values } });
      if (r.status === "awaiting_payment" && r.paymentId) {
        router.push(`/${slug}/payments/${r.paymentId}`);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["event", slug, id] });
    } catch (err) {
      if (err instanceof ApiError && err.details?.fields && typeof err.details.fields === "object") setFieldErrors(err.details.fields as Record<string, string>);
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const cancel = async (regId: string) => {
    if (!window.confirm("ثبت‌نام شما لغو شود؟")) return;
    setPending(true);
    try {
      await api(`/v1/me/event-registrations/${regId}/cancel`, { method: "POST", tenant: slug });
      await qc.invalidateQueries({ queryKey: ["event", slug, id] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <QueryView query={q}>
      {(e) => (
        <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_22rem]">
          <article className="flex min-w-0 flex-col gap-5">
            <Link href={`/${slug}/events`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowRight aria-hidden className="size-4" />
              همه رویدادها
            </Link>
            {e.coverFileId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/proxy/v1/tenants/${slug}/events/${e.id}/cover`} alt="" className="aspect-[16/9] w-full rounded-3xl object-cover" />
            )}
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Badge>
                {e.category && <span className="text-sm text-muted-foreground">{e.category}</span>}
                {e.host && <span className="text-sm text-muted-foreground">· میزبان: {e.host.nameFa}</span>}
              </div>
              <h1 className="text-2xl font-black leading-[1.6] sm:text-3xl">{e.title}</h1>
              {e.organizer && <p className="text-muted-foreground">برگزارکننده: {e.organizer}</p>}
            </header>
            <dl className="grid gap-3 rounded-3xl border border-border bg-card p-5 sm:grid-cols-2">
              <Info icon={CalendarDays} label="زمان">
                {fmtDateTime(e.startsAt)} تا {fmtDateTime(e.endsAt)}
              </Info>
              {e.location && <Info icon={MapPin} label="مکان">{e.location}</Info>}
              {e.onlineUrl && (
                <Info icon={Video} label="برخط">
                  {e.onlineUrl === "registered-only" ? "پیوند پس از ثبت‌نام نمایش داده می‌شود" : <a href={e.onlineUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all text-primary underline">{e.onlineUrl}</a>}
                </Info>
              )}
              {e.capacity && <Info icon={Users} label="ظرفیت">{fmtNum(e.taken)} از {fmtNum(e.capacity)} نفر</Info>}
              <Info icon={Wallet} label="هزینه">{e.feeAmount ? fmtRial(e.feeAmount) : "رایگان"}</Info>
              {e.registrationDeadline && <Info icon={Clock} label="مهلت ثبت‌نام">{fmtDateTime(e.registrationDeadline)}</Info>}
            </dl>
            {e.descriptionHtml && <div className="rich" dangerouslySetInnerHTML={{ __html: e.descriptionHtml }} />}
          </article>

          <aside aria-labelledby="reg" className="h-fit rounded-3xl border border-border bg-card p-5 lg:sticky lg:top-24">
            <h2 id="reg" className="text-lg font-bold">ثبت‌نام</h2>
            {e.mine && e.mine.status !== "cancelled" ? (
              <div className="mt-4 flex flex-col gap-3">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 aria-hidden className="size-5 text-success" />
                  <Badge tone={REGISTRATION_STATUS[e.mine.status].tone}>{REGISTRATION_STATUS[e.mine.status].label}</Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  کد ثبت‌نام: <span dir="ltr" className="font-mono font-bold text-foreground">{e.mine.code}</span>
                </p>
                {e.mine.status === "awaiting_payment" && e.mine.paymentId && (
                  <>
                    <p className="text-sm leading-7 text-muted-foreground">جای شما نگه داشته شده است؛ ثبت‌نام پس از پرداخت هزینه قطعی می‌شود.</p>
                    <Link href={`/${slug}/payments/${e.mine.paymentId}`} className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
                      پرداخت {fmtRial(e.feeAmount)}
                    </Link>
                  </>
                )}
                {e.mine.status === "waitlisted" && <p className="text-sm leading-7 text-muted-foreground">با آزاد شدن ظرفیت، ثبت‌نام شما خودکار قطعی می‌شود و پیام دریافت می‌کنید.</p>}
                {e.mine.status === "pending" && <p className="text-sm leading-7 text-muted-foreground">ثبت‌نام شما پس از تأیید برگزارکننده قطعی می‌شود.</p>}
                {e.allowCancel && e.status !== "held" && e.mine.status !== "rejected" && (
                  <Button variant="secondary" loading={pending} onClick={() => void cancel(e.mine!.id)}>
                    لغو ثبت‌نام
                  </Button>
                )}
              </div>
            ) : !e.registration.open ? (
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{e.status === "cancelled" ? "این رویداد لغو شده است." : "ثبت‌نام این رویداد در حال حاضر باز نیست."}</p>
            ) : !session.data ? (
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-sm leading-7 text-muted-foreground">برای ثبت‌نام وارد حساب خود شوید.</p>
                <Link href={`/${slug}/login?next=${encodeURIComponent(`/${slug}/events/${e.id}`)}`} className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
                  ورود و ثبت‌نام
                </Link>
              </div>
            ) : !e.registration.eligible ? (
              <p className="mt-3 text-sm leading-7 text-muted-foreground">ثبت‌نام این رویداد برای گروه مشخصی است و شما در آن قرار ندارید.</p>
            ) : (
              <form onSubmit={register} noValidate className="mt-4 flex flex-col gap-4">
                {e.registration.full && <p role="status" className="rounded-2xl bg-warning-bg p-3 text-sm leading-7">ظرفیت تکمیل است؛ {e.waitlist ? "در فهرست انتظار قرار می‌گیرید." : "امکان ثبت‌نام نیست."}</p>}
                {e.form.length > 0 && <FormFields fields={e.form} values={values} onChange={setValues} errors={fieldErrors} tenant={e.host?.slug ?? slug} showInternal={false} />}
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <Button type="submit" loading={pending} disabled={e.registration.full && !e.waitlist}>
                  {e.registration.full ? "ورود به فهرست انتظار" : e.feeAmount ? `ثبت‌نام و پرداخت ${fmtRial(e.feeAmount)}` : "ثبت‌نام"}
                </Button>
              </form>
            )}
            {error && e.mine && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
            {e.callForPapers && (
              <section aria-labelledby="cfp" className="mt-5 border-t border-border pt-5">
                <h2 id="cfp" className="flex items-center gap-2 text-lg font-bold">
                  <FileText aria-hidden className="size-5 text-primary" />
                  فراخوان مقاله
                </h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  داوری {e.callForPapers.reviewMode ? REVIEW_MODE[e.callForPapers.reviewMode].label : ""}
                  {e.callForPapers.deadline && <> · مهلت ارسال {fmtDateTime(e.callForPapers.deadline)}</>}
                </p>
                {!e.callForPapers.open ? (
                  <p className="mt-2 text-sm text-muted-foreground">مهلت ارسال مقاله گذشته است.</p>
                ) : !session.data ? (
                  <Link href={`/${slug}/login?next=${encodeURIComponent(`/${slug}/events/${e.id}`)}`} className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-full border border-border text-sm font-semibold hover:bg-muted">
                    ورود برای ارسال مقاله
                  </Link>
                ) : e.callForPapers.eligible ? (
                  <Link href={`/${slug}/papers/new?event=${e.id}`} className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-full border border-primary text-sm font-semibold text-primary hover:bg-primary/5">
                    ارسال مقاله به همایش
                  </Link>
                ) : (
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">
                    {e.callForPapers.ownMembersOnly ? "ارسال مقاله فقط برای اعضای دانشگاه برگزارکننده است." : "ارسال مقاله به این همایش برای گروه مشخصی است و شما در آن قرار ندارید."}
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>
      )}
    </QueryView>
  );
}

function Info({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 leading-7">{children}</dd>
      </div>
    </div>
  );
}
