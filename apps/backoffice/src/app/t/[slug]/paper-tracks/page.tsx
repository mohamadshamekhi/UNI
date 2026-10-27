"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Route } from "lucide-react";
import { useState } from "react";
import { api } from "@uni/shared/api";
import { toFaDigits } from "@uni/shared/format";
import { REVIEW_MODE } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { Button } from "@uni/shared/ui/button";
import { FormDialog } from "@uni/shared/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@uni/shared/ui/field";
import { PageHeader } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import { useToast } from "@uni/shared/ui/toast";
import type { PaperTrack, ReviewMode } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

const EMPTY = { nameFa: "", description: "", reviewMode: "double_blind" as ReviewMode, maxRounds: 3, reviewerDays: 14, minReviewers: 2, reviewerDownload: true, active: true };

/** Submission tracks (PAP-09): the review mode is copied into each paper and locked at submission. */
export default function PaperTracksPage() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["paper-tracks-admin", slug], queryFn: () => api<PaperTrack[]>("/v1/admin/paper-tracks", { tenant: slug }) });
  const [editing, setEditing] = useState<PaperTrack | "new" | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="پژوهش"
        title="روندهای ارسال مقاله"
        description="حالت داوری هر روند هنگام ارسال روی مقاله قفل می‌شود؛ تغییر آن فقط بر مقاله‌های بعدی اثر دارد."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden className="size-4" />
            روند جدید
          </Button>
        }
      />
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Route} title="هنوز روندی تعریف نشده" description="بدون روند فعال، نویسندگان نمی‌توانند مقاله ارسال کنند." />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{t.nameFa}</p>
                    {t.description && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
                  </div>
                  <Badge tone={t.active ? "success" : "neutral"}>{t.active ? "فعال" : "غیرفعال"}</Badge>
                </div>
                <p className="text-sm">
                  داوری <span className="font-semibold">{REVIEW_MODE[t.reviewMode].label}</span> · حداکثر {toFaDigits(String(t.maxRounds))} دور · مهلت داور {toFaDigits(String(t.reviewerDays))} روز
                </p>
                <Button size="sm" variant="secondary" className="self-start" onClick={() => setEditing(t)}>
                  <Pencil aria-hidden className="size-4" />
                  ویرایش
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      <TrackDialog target={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TrackDialog({ target, onClose }: { target: PaperTrack | "new" | null; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(EMPTY);
  const [last, setLast] = useState(target);
  if (target !== last) {
    setLast(target);
    if (target) setV(target === "new" ? EMPTY : { ...EMPTY, ...target, description: target.description ?? "" });
  }
  const num = (k: "maxRounds" | "reviewerDays" | "minReviewers", value: string) => setV({ ...v, [k]: Math.max(1, Number(value) || 1) });
  return (
    <FormDialog
      open={!!target}
      onClose={onClose}
      title={target === "new" ? "روند جدید" : "ویرایش روند"}
      submitLabel="ذخیره"
      onSubmit={async () => {
        const body = { ...v, description: v.description.trim() || undefined };
        if (target === "new") {
          const { active: _a, ...create } = body;
          await api("/v1/admin/paper-tracks", { method: "POST", tenant: slug, body: create });
        } else await api(`/v1/admin/paper-tracks/${(target as PaperTrack).id}`, { method: "PATCH", tenant: slug, body });
        qc.invalidateQueries({ queryKey: ["paper-tracks-admin", slug] });
        toast("روند ذخیره شد.");
      }}
    >
      <Field label="نام" required>
        {(p) => <Input {...p} value={v.nameFa} maxLength={120} onChange={(e) => setV({ ...v, nameFa: e.target.value })} />}
      </Field>
      <Field label="توضیح">
        {(p) => <Textarea {...p} value={v.description} maxLength={1000} onChange={(e) => setV({ ...v, description: e.target.value })} />}
      </Field>
      <Field label="حالت داوری" hint={REVIEW_MODE[v.reviewMode].hint}>
        {(p) => (
          <Select {...p} value={v.reviewMode} onChange={(e) => setV({ ...v, reviewMode: e.target.value as ReviewMode })}>
            {Object.entries(REVIEW_MODE).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="حداکثر دور">{(p) => <Input {...p} type="number" dir="ltr" min={1} max={10} value={v.maxRounds} onChange={(e) => num("maxRounds", e.target.value)} />}</Field>
        <Field label="مهلت داور (روز)">{(p) => <Input {...p} type="number" dir="ltr" min={1} max={120} value={v.reviewerDays} onChange={(e) => num("reviewerDays", e.target.value)} />}</Field>
        <Field label="حداقل داور">{(p) => <Input {...p} type="number" dir="ltr" min={1} max={10} value={v.minReviewers} onChange={(e) => num("minReviewers", e.target.value)} />}</Field>
      </div>
      <Checkbox label="داوران بتوانند فایل مقاله را دریافت کنند" checked={v.reviewerDownload} onChange={(e) => setV({ ...v, reviewerDownload: e.target.checked })} />
      {target !== "new" && <Checkbox label="فعال (پذیرش مقاله جدید)" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />}
    </FormDialog>
  );
}
