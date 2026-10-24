"use client";

import { useState } from "react";
import { AuditLog } from "@/components/audit-log";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";

export default function PlatformAuditPage() {
  const [tenantId, setTenantId] = useState("");
  const valid = /^[0-9a-f-]{36}$/.test(tenantId);
  return (
    <>
      <PageHeader title="ممیزی سراسری" description="زنجیره ممیزی سامانه؛ با وارد کردن شناسه سازمان، ممیزی همان سازمان نمایش داده می‌شود و این مشاهده هم ثبت می‌شود." />
      <Field label="شناسه سازمان (اختیاری)" className="mb-4 max-w-md">
        {(p) => <Input {...p} dir="ltr" value={tenantId} onChange={(e) => setTenantId(e.target.value.trim())} />}
      </Field>
      <AuditLog basePath="/v1/platform/audit" extraQuery={valid ? { tenantId } : undefined} />
    </>
  );
}
