"use client";

import { Card, PageHeader } from "@uni/shared/ui/layout";
import { InboxList, NotificationPreferences } from "@uni/shared/ui/notifications";
import { useSlug } from "@/lib/hooks";

const staffLink = (link: string | null) => (link?.startsWith("/t/") ? link : null);

export default function NotificationsPage() {
  const slug = useSlug();
  return (
    <>
      <PageHeader eyebrow="کار من" title="اعلان‌ها" description="ارجاع‌ها، یادآوری مهلت‌ها و تغییرات پرونده‌هایی که با آن‌ها سروکار دارید." />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <InboxList tenant={slug} resolve={staffLink} />
        <Card title="کانال‌های دریافت" className="self-start">
          <NotificationPreferences tenant={slug} />
        </Card>
      </div>
    </>
  );
}
