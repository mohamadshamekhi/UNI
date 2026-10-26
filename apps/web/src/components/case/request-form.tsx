"use client";

import { useCallback } from "react";
import { api } from "@uni/shared/api";
import { FormFields, type FormValues } from "@uni/shared/ui/form-fields";
import type { FormFieldDef, MemberCandidate } from "@uni/shared/types";
import { useTenantSlug } from "@/lib/tenant";

/** Request form for applicants; member fields list eligible people for this request type (THS-02). */
export function RequestFormFields({
  requestType,
  fields,
  values,
  onChange,
  errors,
}: {
  requestType: string;
  fields: FormFieldDef[];
  values: FormValues;
  onChange: (v: FormValues) => void;
  errors: Record<string, string>;
}) {
  const slug = useTenantSlug();
  const degree = typeof values.degree === "string" ? values.degree : undefined;
  const memberSource = useCallback(
    (f: FormFieldDef) => api<MemberCandidate[]>("/v1/cases/eligible-members", { tenant: slug, query: { requestType, field: f.key, degree } }),
    [slug, requestType, degree],
  );
  return <FormFields fields={fields} values={values} onChange={onChange} errors={errors} tenant={slug} showInternal={false} memberSource={memberSource} />;
}
