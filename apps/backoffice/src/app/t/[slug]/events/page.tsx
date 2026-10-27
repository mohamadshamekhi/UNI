"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDateTime } from "@uni/shared/format";
import { EVENT_STATUS, EVENT_VISIBILITY } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { EventStatus, EventVisibility } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

interface Row {
  id: string;
  title: string;
  status: EventStatus;
  visibility: EventVisibility;
  startsAt: string;
  capacity: number | null;
  location: string | null;
}

/** Events organised in the user's units (EVT-01). */
export default function EventsAdminPage() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["events-admin", slug], queryFn: () => api<Row[]>("/v1/admin/events", { tenant: slug }) });
  return (
    <>
      <PageHeader
        eyebrow="اطلاع‌رسانی"
        title="رویدادها"
        description="نمایش رویداد، شرایط ثبت‌نام و ظرفیت سه تنظیم جدا هستند."
        actions={
          <Link href={`/t/${slug}/events/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            <Plus aria-hidden className="size-4" />
            رویداد جدید
          </Link>
        }
      />
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={CalendarDays} title="هنوز رویدادی تعریف نشده" />}>
        {(list) => (
          <Table caption="رویدادها">
            <thead>
              <tr>
                <Th>عنوان</Th>
                <Th>زمان</Th>
                <Th>نمایش</Th>
                <Th>وضعیت</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="hover:bg-muted/40">
                  <Td>
                    <Link href={`/t/${slug}/events/${e.id}`} className="font-semibold hover:text-primary hover:underline">{e.title}</Link>
                    {e.location && <p className="text-xs text-muted-foreground">{e.location}</p>}
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(e.startsAt)}</Td>
                  <Td>{EVENT_VISIBILITY[e.visibility]}</Td>
                  <Td><Badge tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}
