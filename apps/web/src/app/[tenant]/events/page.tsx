"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, Ticket, Users, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDateTime, fmtNum } from "@uni/shared/format";
import { EVENT_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { EventCard } from "@uni/shared/types";
import { HeroBackdrop } from "@/components/site/sections";
import { useSession, useTenantSlug } from "@/lib/tenant";

/** Events of this university plus public / shared events of other universities (EVT-02). */
export default function EventsPage() {
  const slug = useTenantSlug();
  const session = useSession();
  const [upcoming, setUpcoming] = useState(true);
  const q = useQuery({
    queryKey: ["events", slug, upcoming],
    queryFn: () => api<EventCard[]>("/v1/events", { tenant: slug, public: true, query: { upcoming, limit: 60 } }),
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className="hero-band enter relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <HeroBackdrop />
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm text-white/70">همایش‌ها، کارگاه‌ها و نشست‌ها</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">رویدادها</h1>
          </div>
          {session.data && (
            <Link href={`/${slug}/events/mine`} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#0b1f52] shadow-lg hover:bg-white/90">
              <Ticket aria-hidden className="size-4" />
              ثبت‌نام‌های من
            </Link>
          )}
        </div>
      </section>
      <div role="group" aria-label="بازه زمانی" className="flex gap-2">
        {[
          { v: true, l: "پیش رو" },
          { v: false, l: "همه" },
        ].map((o) => (
          <button key={o.l} type="button" aria-pressed={upcoming === o.v} onClick={() => setUpcoming(o.v)} className={`h-10 cursor-pointer rounded-full border px-4 text-sm transition-colors ${upcoming === o.v ? "border-primary bg-primary text-on-primary" : "border-border bg-card hover:border-primary/40"}`}>
            {o.l}
          </button>
        ))}
      </div>
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={CalendarDays} title="رویدادی برای نمایش نیست" />}>
        {(list) => (
          <ul className="grid gap-4 md:grid-cols-2">
            {list.map((e) => (
              <li key={e.id}>
                <Link href={`/${slug}/events/${e.id}`} className="group flex h-full gap-4 rounded-3xl border border-border bg-card p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
                  <div className="size-24 shrink-0 overflow-hidden rounded-2xl bg-muted">
                    {e.coverFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/proxy/v1/tenants/${slug}/events/${e.id}/cover`} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-muted-foreground">
                        <CalendarDays aria-hidden className="size-7" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Badge>
                      {e.host && <span className="text-xs text-muted-foreground">میزبان: {e.host.nameFa}</span>}
                    </div>
                    <h2 className="line-clamp-2 font-bold leading-7 group-hover:text-primary">{e.title}</h2>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarDays aria-hidden className="size-4" />
                      {fmtDateTime(e.startsAt)}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      {e.location && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin aria-hidden className="size-4" />
                          {e.location}
                        </span>
                      )}
                      {e.online && (
                        <span className="inline-flex items-center gap-1.5">
                          <Video aria-hidden className="size-4" />
                          برخط
                        </span>
                      )}
                      {e.capacity && (
                        <span className="inline-flex items-center gap-1.5">
                          <Users aria-hidden className="size-4" />
                          {fmtNum(e.taken)} از {fmtNum(e.capacity)}
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
