"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { Button } from "@uni/shared/ui/button";
import { Field, Input, Textarea } from "@uni/shared/ui/field";
import { type FormValues } from "@uni/shared/ui/form-fields";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { RequestType } from "@uni/shared/types";
import { RequestFormFields } from "@/components/case/request-form";
import { useTenantSlug } from "@/lib/tenant";

/**
 * Start a case: pick a request type with a published workflow, fill its request form, then save
 * a draft (THS-01) or submit right away.
 */
export default function NewCasePage() {
  const slug = useTenantSlug();
  const router = useRouter();
  const types = useQuery({ queryKey: ["request-types", slug], queryFn: () => api<RequestType[]>("/v1/cases/request-types", { tenant: slug }) });
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"draft" | "submit" | null>(null);
  const form = types.data?.find((t) => t.requestType === type)?.requestForm ?? [];

  const save = async (draft: boolean) => {
    if (!type) return setError("نوع درخواست را انتخاب کنید.");
    if (!title.trim()) return setError("عنوان درخواست را بنویسید.");
    setPending(draft ? "draft" : "submit");
    setError(null);
    setFieldErrors({});
    try {
      const c = await api<{ id: string }>("/v1/cases", {
        method: "POST",
        tenant: slug,
        body: { requestType: type, title: title.trim(), draft, data: form.length ? values : description.trim() ? { description: description.trim() } : {} },
      });
      router.push(`/${slug}/cases/${c.id}${draft ? "" : "?created=1"}`);
    } catch (err) {
      if (err instanceof ApiError && err.details?.fields && typeof err.details.fields === "object" && !Array.isArray(err.details.fields)) setFieldErrors(err.details.fields as Record<string, string>);
      setError(errorMessage(err));
      setPending(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href={`/${slug}/cases`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        پرونده‌های من
      </Link>
      <div className="enter rounded-[2rem] border border-border bg-card p-6 shadow-[0_30px_60px_-30px_rgb(15_23_42/0.35)] sm:p-10">
        <h1 className="text-2xl font-black">ثبت درخواست جدید</h1>
        <p className="mt-2 mb-8 text-sm leading-7 text-muted-foreground">می‌توانید پیش‌نویس را ذخیره کنید و بعداً کامل و ارسال کنید. پس از ارسال، درخواست به مسئول مربوط ارجاع می‌شود.</p>
        <QueryView
          query={types}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon={FileText} title="فعلاً درخواستی قابل ثبت نیست" description="دانشگاه هنوز فرایندی برای ثبت درخواست منتشر نکرده است." />}
        >
          {(list) => (
            <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  نوع درخواست <span className="text-danger" aria-hidden>*</span>
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((t) => (
                    <label
                      key={t.requestType}
                      className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-info-bg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
                    >
                      <input
                        type="radio"
                        name="type"
                        value={t.requestType}
                        checked={type === t.requestType}
                        onChange={() => (setType(t.requestType), setValues({}), setFieldErrors({}))}
                        className="mt-1 size-4 accent-[var(--primary)]"
                      />
                      <span>
                        <span className="block font-semibold">{t.nameFa}</span>
                        {t.description && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="عنوان" required hint="یک عنوان کوتاه که درخواست را مشخص کند.">
                {(p) => <Input {...p} className="h-11" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
              {form.length ? (
                <RequestFormFields requestType={type} fields={form} values={values} onChange={setValues} errors={fieldErrors} />
              ) : (
                <Field label="توضیحات" hint="جزئیاتی که کارشناس برای بررسی لازم دارد.">
                  {(p) => <Textarea {...p} className="min-h-32" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />}
                </Field>
              )}
              {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" size="lg" loading={pending === "submit"} disabled={pending !== null}>ثبت و ارسال</Button>
                <Button variant="secondary" size="lg" loading={pending === "draft"} disabled={pending !== null} onClick={() => save(true)}>
                  <Save aria-hidden className="size-4" />
                  ذخیره پیش‌نویس
                </Button>
              </div>
            </form>
          )}
        </QueryView>
      </div>
    </div>
  );
}
