"use client";

import { AuditLog } from "@/components/audit-log";
import { PageHeader } from "@uni/shared/ui/layout";
import { useSlug } from "@/lib/hooks";

export default function TenantAuditPage() {
  const slug = useSlug();
  return (
    <>
      <PageHeader title="ممیزی" description="ثبت غیرقابل‌تغییر اقدامات حساس در این سازمان" />
      <AuditLog basePath="/v1/admin/audit" tenant={slug} />
    </>
  );
}
