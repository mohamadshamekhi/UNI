"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { api, errorMessage } from "@uni/shared/api";
import { DEGREE, REVIEW_MODE } from "@uni/shared/labels";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { Loading, QueryView } from "@uni/shared/ui/states";
import type { EventDetail, PaperTrack } from "@uni/shared/types";
import { fmtDateTime } from "@uni/shared/format";
import { ManuscriptUpload } from "@/components/paper/manuscript-upload";
import { useTenantSlug } from "@/lib/tenant";

export default function NewPaperPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewPaper />
    </Suspense>
  );
}

/**
 * PAP-01: only the manuscript and the degree are required; the rest helps reviewer assignment.
 * With `?event=` it is a conference paper: the event's call decides the track (EVT-11).
 */
function NewPaper() {
  const slug = useTenantSlug();
  const router = useRouter();
  const eventId = useSearchParams().get("event");
  const tracks = useQuery({ queryKey: ["paper-tracks", slug], queryFn: () => api<PaperTrack[]>("/v1/paper-tracks", { tenant: slug }) });
  const event = useQuery({ queryKey: ["event", slug, eventId], enabled: !!eventId, queryFn: () => api<EventDetail>(`/v1/events/${eventId}`, { tenant: slug }) });
  const call = event.data?.callForPapers ?? null;
  const [v, setV] = useState({ trackId: "", title: "", abstract: "", keywords: "", degree: "", field: "", conflictNote: "" });
  const [coAuthors, setCoAuthors] = useState<{ fullName: string; affiliation: string }[]>([]);
  const [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const track = tracks.data?.find((t) => t.id === v.trackId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!eventId && !v.trackId) err.trackId = "روند ارسال را انتخاب کنید.";
    if (!v.title.trim()) err.title = "عنوان مقاله را بنویسید.";
    if (!v.degree) err.degree = "مقطع تحصیلی را انتخاب کنید.";
    if (!file) err.file = "فایل مقاله را بارگذاری کنید.";
    setErrors(err);
    if (Object.keys(err).length) return;
    setPending(true);
    setError(null);
    try {
      const p = await api<{ id: string }>("/v1/papers", {
        method: "POST",
        tenant: slug,
        body: {
          ...(eventId ? { eventId } : { trackId: v.trackId }),
          title: v.title.trim(),
          abstract: v.abstract.trim() || undefined,
          keywords: v.keywords.split(/[,،]/).map((k) => k.trim()).filter(Boolean),
          degree: v.degree,
          field: v.field.trim() || undefined,
          coAuthors: coAuthors.filter((c) => c.fullName.trim()).map((c) => ({ fullName: c.fullName.trim(), affiliation: c.affiliation.trim() || undefined })),
          conflicts: v.conflictNote.trim() ? { note: v.conflictNote.trim() } : undefined,
        },
      });
      await api(`/v1/papers/${p.id}/submit`, { method: "POST", tenant: slug, body: { manuscriptFileId: file!.id } });
      router.push(`/${slug}/papers/${p.id}?submitted=1`);
    } catch (e2) {
      setError(errorMessage(e2));
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href={`/${slug}/papers`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        مقالات من
      </Link>
      <div className="enter rounded-[2rem] border border-border bg-card p-6 shadow-[0_30px_60px_-30px_rgb(15_23_42/0.35)] sm:p-10">
        <h1 className="text-2xl font-black">{eventId ? "ارسال مقاله به همایش" : "ارسال مقاله"}</h1>
        <p className="mt-2 mb-8 text-sm leading-7 text-muted-foreground">پس از ارسال، شناسه پیگیری صادر می‌شود و مقاله در صف بررسی اولیه قرار می‌گیرد.</p>
        <QueryView query={tracks}>
          {(list) => (
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
              {eventId && event.data && (
                <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                  <CalendarDays aria-hidden className="mt-0.5 size-5 text-primary" />
                  <div className="text-sm leading-7">
                    <p className="font-bold">{event.data.title}</p>
                    {call && (
                      <p className="text-muted-foreground">
                        داوری {call.reviewMode ? REVIEW_MODE[call.reviewMode as keyof typeof REVIEW_MODE].label : ""}
                        {call.deadline && <> · مهلت ارسال {fmtDateTime(call.deadline)}</>}
                      </p>
                    )}
                    {call && (!call.open || !call.eligible) && <p className="text-danger">{!call.open ? "مهلت ارسال مقاله به این همایش گذشته است." : "ارسال مقاله به این همایش برای گروه مشخصی است."}</p>}
                  </div>
                </div>
              )}
              {!eventId && <Field label="روند ارسال" required error={errors.trackId} hint={track ? `داوری ${REVIEW_MODE[track.reviewMode].label}: ${REVIEW_MODE[track.reviewMode].hint}` : undefined}>
                {(p) => (
                  <Select {...p} value={v.trackId} onChange={(e) => setV({ ...v, trackId: e.target.value })}>
                    <option value="">انتخاب کنید</option>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>{t.nameFa}</option>
                    ))}
                  </Select>
                )}
              </Field>}
              <Field label="عنوان مقاله" required error={errors.title}>
                {(p) => <Input {...p} className="h-11" value={v.title} maxLength={300} onChange={(e) => setV({ ...v, title: e.target.value })} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="مقطع تحصیلی مرتبط" required error={errors.degree}>
                  {(p) => (
                    <Select {...p} value={v.degree} onChange={(e) => setV({ ...v, degree: e.target.value })}>
                      <option value="">انتخاب کنید</option>
                      {Object.entries({ ...DEGREE, other: "غیره" }).map(([k, l]) => (
                        <option key={k} value={k}>{l}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="حوزه موضوعی">
                  {(p) => <Input {...p} value={v.field} maxLength={120} onChange={(e) => setV({ ...v, field: e.target.value })} />}
                </Field>
              </div>
              <Field label="چکیده">
                {(p) => <Textarea {...p} className="min-h-32" value={v.abstract} maxLength={5000} onChange={(e) => setV({ ...v, abstract: e.target.value })} />}
              </Field>
              <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید؛ حداکثر ۱۰ مورد.">
                {(p) => <Input {...p} value={v.keywords} onChange={(e) => setV({ ...v, keywords: e.target.value })} />}
              </Field>

              <fieldset className="flex flex-col gap-3 rounded-2xl border border-border p-4">
                <legend className="px-1 text-sm font-medium">نویسندگان همکار</legend>
                {coAuthors.map((c, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input aria-label={`نام نویسنده همکار ${i + 1}`} placeholder="نام و نام خانوادگی" value={c.fullName} onChange={(e) => setCoAuthors(coAuthors.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)))} />
                    <Input aria-label={`وابستگی سازمانی ${i + 1}`} placeholder="وابستگی سازمانی" value={c.affiliation} onChange={(e) => setCoAuthors(coAuthors.map((x, j) => (j === i ? { ...x, affiliation: e.target.value } : x)))} />
                    <Button variant="ghost" aria-label="حذف" onClick={() => setCoAuthors(coAuthors.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" size="sm" className="self-start" disabled={coAuthors.length >= 20} onClick={() => setCoAuthors([...coAuthors, { fullName: "", affiliation: "" }])}>
                  <Plus aria-hidden className="size-4" />
                  افزودن نویسنده همکار
                </Button>
              </fieldset>

              <Field label="اظهار تضاد منافع" hint="اگر داوران خاصی برای این مقاله مناسب نیستند، اینجا بنویسید.">
                {(p) => <Textarea {...p} value={v.conflictNote} maxLength={1000} onChange={(e) => setV({ ...v, conflictNote: e.target.value })} />}
              </Field>

              <ManuscriptUpload tenant={slug} value={file} onChange={setFile} blind={track?.reviewMode === "double_blind"} />
              {errors.file && <p role="alert" className="-mt-3 text-xs text-danger">{errors.file}</p>}
              {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" loading={pending}>ارسال مقاله</Button>
            </form>
          )}
        </QueryView>
      </div>
    </div>
  );
}
