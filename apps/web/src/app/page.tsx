"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@uni/shared/api";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { Building2, ChevronLeft } from "lucide-react";
import Link from "next/link";

interface TenantItem {
  slug: string;
  nameFa: string;
  nameEn: string | null;
}

/** Organisation picker (section 6, step 1); in production each university also has its own subdomain. */
export default function Home() {
  const tenants = useQuery({ queryKey: ["public-tenants"], queryFn: () => api<TenantItem[]>("/v1/public/tenants", { public: true }) });
  return (
    <main id="main" className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">سامانه خدمات دانشگاهی</h1>
      <p className="mt-2 mb-8 text-muted-foreground">دانشگاه یا مؤسسه خود را انتخاب کنید.</p>
      <QueryView query={tenants} isEmpty={(d) => d.length === 0} empty={<EmptyState title="هنوز سازمانی فعال نیست" />}>
        {(rows) => (
          <ul className="flex flex-col gap-3">
            {rows.map((t) => (
              <li key={t.slug}>
                <Link href={`/${t.slug}`} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary">
                  <Building2 aria-hidden className="size-5 text-muted-foreground" />
                  <span className="flex-1">
                    <span className="block font-medium">{t.nameFa}</span>
                    {t.nameEn && <span className="block text-sm text-muted-foreground">{t.nameEn}</span>}
                  </span>
                  <ChevronLeft aria-hidden className="size-5 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </main>
  );
}
