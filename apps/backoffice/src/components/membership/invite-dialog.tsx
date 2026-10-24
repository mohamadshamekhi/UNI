"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormDialog } from "@uni/shared/ui/dialog";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { useToast } from "@uni/shared/ui/toast";
import { api } from "@uni/shared/api";
import { useSlug, useUnits } from "@/lib/hooks";

const EMPTY = { kind: "faculty", fullName: "", mobile: "", email: "", unitId: "", memberNo: "" };

/** Expert-defined member (section 6, «روش اصلی»): active immediately, SMS invitation. */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const slug = useSlug();
  const { flat } = useUnits(slug);
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="دعوت عضو"
      submitLabel="ثبت و ارسال دعوت"
      onSubmit={async () => {
        await api("/v1/admin/memberships/invite", {
          method: "POST",
          tenant: slug,
          body: { ...f, email: f.email || undefined, memberNo: f.memberNo || undefined },
        });
        qc.invalidateQueries({ queryKey: ["memberships", slug] });
        toast(`دعوت‌نامه برای ${f.fullName} پیامک شد.`);
        setF(EMPTY);
      }}
    >
      <Field label="نوع عضویت" required>
        {(p) => (
          <Select {...p} value={f.kind} onChange={set("kind")}>
            <option value="faculty">استاد</option>
            <option value="staff">کارمند</option>
            <option value="student">دانشجو</option>
          </Select>
        )}
      </Field>
      <Field label="نام و نام خانوادگی" required>{(p) => <Input {...p} value={f.fullName} onChange={set("fullName")} />}</Field>
      <Field label="شماره موبایل" required>{(p) => <Input {...p} dir="ltr" inputMode="tel" value={f.mobile} onChange={set("mobile")} />}</Field>
      <Field label="ایمیل">{(p) => <Input {...p} dir="ltr" type="email" value={f.email} onChange={set("email")} />}</Field>
      <Field label="واحد" required>
        {(p) => (
          <Select {...p} value={f.unitId} onChange={set("unitId")}>
            <option value="" disabled>انتخاب کنید</option>
            {flat.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="شماره پرسنلی/دانشجویی">{(p) => <Input {...p} value={f.memberNo} onChange={set("memberNo")} />}</Field>
    </FormDialog>
  );
}
