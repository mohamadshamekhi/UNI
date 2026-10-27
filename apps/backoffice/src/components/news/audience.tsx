"use client";

import { useQuery } from "@tanstack/react-query";
import { Globe2, Users, X } from "lucide-react";
import { api } from "@uni/shared/api";
import { Checkbox, Select } from "@uni/shared/ui/field";
import type { Audience, Role } from "@uni/shared/types";
import { useUnits } from "@/lib/hooks";

/** Rules are OR-ed: anyone matching one rule sees the post (NWS-02). */
export function audienceSummary(a: Audience, unitName: (id: string) => string, roleName: (k: string) => string) {
  if (a.public) return "عمومی (همه حتی بدون ورود)";
  const parts: string[] = [];
  if (a.members) parts.push("همه اعضا");
  for (const u of a.units ?? []) parts.push(`${unitName(u.id)}${u.tree ? " و زیرمجموعه" : ""}`);
  for (const r of a.roles ?? []) parts.push(`نقش ${roleName(r)}`);
  if (a.memberships?.length) parts.push(`${a.memberships.length} نفر مشخص`);
  return parts.join("، ") || "هیچ‌کس";
}

export function AudienceBuilder({ slug, value, onChange, disabled }: { slug: string; value: Audience; onChange: (a: Audience) => void; disabled?: boolean }) {
  const { flat } = useUnits(slug);
  const roles = useQuery({ queryKey: ["roles", slug], queryFn: () => api<Role[]>("/v1/admin/roles", { tenant: slug }), retry: false });
  const units = value.units ?? [];
  const roleKeys = value.roles ?? [];
  const unitName = (id: string) => flat.find((u) => u.id === id)?.label ?? "واحد";
  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.nameFa ?? k;

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <legend className="px-1 text-sm font-semibold">مخاطبان</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={!!value.public}
          onClick={() => onChange(value.public ? { members: true } : { public: true })}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-start ${value.public ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
        >
          <Globe2 aria-hidden className="mt-0.5 size-5 text-primary" />
          <span>
            <span className="block font-semibold">عمومی</span>
            <span className="text-xs text-muted-foreground">همه بازدیدکنندگان؛ قابل نمایش در موتورهای جستجو</span>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={!value.public}
          onClick={() => !value.public || onChange({ members: true })}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-start ${!value.public ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
        >
          <Users aria-hidden className="mt-0.5 size-5 text-primary" />
          <span>
            <span className="block font-semibold">داخلی</span>
            <span className="text-xs text-muted-foreground">فقط اعضای واردشده‌ای که با یکی از قواعد زیر جور باشند</span>
          </span>
        </button>
      </div>

      {!value.public && (
        <>
          <Checkbox label="همه اعضای فعال دانشگاه" checked={!!value.members} onChange={(e) => onChange({ ...value, members: e.target.checked || undefined })} />
          <div className="flex flex-col gap-2">
            <label htmlFor="aud-unit" className="text-sm font-medium">واحدها</label>
            <Select
              id="aud-unit"
              value=""
              onChange={(e) => e.target.value && !units.some((u) => u.id === e.target.value) && onChange({ ...value, units: [...units, { id: e.target.value, tree: true }] })}
            >
              <option value="">افزودن واحد…</option>
              {flat.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
            <ul className="flex flex-col gap-1.5">
              {units.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{unitName(u.id)}</span>
                  <label className="inline-flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={!!u.tree} onChange={(e) => onChange({ ...value, units: units.map((x) => (x.id === u.id ? { ...x, tree: e.target.checked } : x)) })} />
                    با زیرمجموعه‌ها
                  </label>
                  <button type="button" aria-label={`حذف ${unitName(u.id)}`} onClick={() => onChange({ ...value, units: units.filter((x) => x.id !== u.id) })} className="grid size-8 cursor-pointer place-items-center rounded-lg hover:bg-card">
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {roles.data && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">نقش‌ها</span>
              <div className="flex flex-wrap gap-2">
                {roles.data.map((r) => {
                  const on = roleKeys.includes(r.key);
                  return (
                    <button key={r.id} type="button" aria-pressed={on} onClick={() => onChange({ ...value, roles: on ? roleKeys.filter((k) => k !== r.key) : [...roleKeys, r.key] })} className={`h-9 cursor-pointer rounded-full border px-3 text-sm ${on ? "border-primary bg-primary text-on-primary" : "border-border hover:border-primary/40"}`}>
                      {r.nameFa}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        قابل مشاهده برای: <span className="font-semibold text-foreground">{audienceSummary(value, unitName, roleName)}</span>
      </p>
    </fieldset>
  );
}
