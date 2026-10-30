"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Ticket } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDateTime } from "@uni/shared/format";
import { REGISTRATION_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { RegistrationStatus } from "@uni/shared/types";
import { useTenantSlug } from "@/lib/tenant";

interface Row {
  id: string;
  eventId: string;
  status: RegistrationStatus;
  code: string;
  attended: boolean;
  title: string;
  startsAt: string;
  location: string | null;
  host: string;
}

/** The signed-in user's registrations, including events of other universities. */
export default function MyRegistrationsPage() {
  const slug = useTenantSlug();
  const q = useQuery({ queryKey: ["my-registrations", slug], queryFn: () => api<Row[]>("/v1/me/event-registrations", { tenant: slug }) });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-black">ثبت‌نام‌های من</h1>
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Ticket} title="هنوز در رویدادی ثبت‌نام نکرده‌اید" action={<Link href={`/${slug}/events`} className="text-primary underline">مشاهده رویدادها</Link>} />}>
        {(list) => (
          <ul className="grid gap-3">
            {list.map((r) => (
              <li key={r.id}>
                <Link href={`/${slug}/events/${r.eventId}`} className="group flex items-center gap-4 rounded-3xl border border-border bg-card p-5 hover:border-primary/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold">{r.title}</p>
                      <Badge tone={REGISTRATION_STATUS[r.status].tone}>{REGISTRATION_STATUS[r.status].label}</Badge>
                      {r.attended && <Badge tone="success">حاضر</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {fmtDateTime(r.startsAt)} · {r.host} · کد <span dir="ltr" className="font-mono">{r.code}</span>
                    </p>
                  </div>
                  <ChevronLeft aria-hidden className="size-5 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
