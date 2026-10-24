"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@uni/shared/ui/button";
import { FormDialog, ReasonDialog } from "@uni/shared/ui/dialog";
import { Field, Input, Select } from "@uni/shared/ui/field";
import { Card } from "@uni/shared/ui/layout";
import { Badge } from "@uni/shared/ui/badge";
import { useToast } from "@uni/shared/ui/toast";
import { api } from "@uni/shared/api";
import { fmtDate } from "@uni/shared/format";
import { useSlug, useUnits } from "@/lib/hooks";
import { SCOPE_TYPE } from "@uni/shared/labels";
import type { Assignment, Role, ScopeType } from "@uni/shared/types";

/** Role + scope + validity window per membership (section 5, «انتساب»). */
export function RoleAssignments({ membershipId }: { membershipId: string }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { byId } = useUnits(slug);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<Assignment | null>(null);
  const key = ["assignments", slug, membershipId];
  const list = useQuery({ queryKey: key, queryFn: () => api<Assignment[]>(`/v1/admin/memberships/${membershipId}/roles`, { tenant: slug }) });
  const [now] = useState(() => Date.now());
  const active = (list.data ?? []).filter((a) => !a.revokedAt);

  return (
    <Card
      title="نقش‌ها"
      actions={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" />
          افزودن نقش
        </Button>
      }
    >
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">نقشی فعال نیست.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((a) => {
            const expired = a.validTo && new Date(a.validTo).getTime() < now;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{a.roleNameFa}</span>
                <span className="text-muted-foreground">
                  {SCOPE_TYPE[a.scopeType]}
                  {a.scopeId && byId.get(a.scopeId) ? `: ${byId.get(a.scopeId)!.label}` : ""}
                </span>
                {a.validTo && <span className="text-xs text-muted-foreground tabular">تا {fmtDate(a.validTo)}</span>}
                {expired && <Badge tone="warning">منقضی</Badge>}
                <Button size="sm" variant="ghost" className="ms-auto text-danger" onClick={() => setRevoking(a)}>
                  لغو
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <AssignDialog open={adding} onClose={() => setAdding(false)} membershipId={membershipId} onDone={() => qc.invalidateQueries({ queryKey: key })} />
      <ReasonDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`لغو نقش «${revoking?.roleNameFa ?? ""}»`}
        submitLabel="لغو نقش"
        onConfirm={async (reason) => {
          await api(`/v1/admin/role-assignments/${revoking!.id}/revoke`, { method: "POST", tenant: slug, body: { reason } });
          qc.invalidateQueries({ queryKey: key });
          toast("نقش لغو شد.");
        }}
      />
    </Card>
  );
}

function AssignDialog({ open, onClose, membershipId, onDone }: { open: boolean; onClose: () => void; membershipId: string; onDone: () => void }) {
  const slug = useSlug();
  const toast = useToast();
  const { flat } = useUnits(slug);
  const roles = useQuery({ queryKey: ["roles", slug], queryFn: () => api<Role[]>("/v1/admin/roles", { tenant: slug }), enabled: open });
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("tenant");
  const [scopeId, setScopeId] = useState("");
  const [validTo, setValidTo] = useState("");
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="افزودن نقش"
      submitLabel="ثبت"
      onSubmit={async () => {
        await api("/v1/admin/role-assignments", {
          method: "POST",
          tenant: slug,
          body: {
            membershipId,
            roleId,
            scopeType,
            scopeId: scopeType === "tenant" ? undefined : scopeId,
            validTo: validTo ? new Date(`${validTo}T23:59:59`).toISOString() : undefined,
          },
        });
        onDone();
        toast("نقش اضافه شد.");
      }}
    >
      <Field label="نقش" required>
        {(p) => (
          <Select {...p} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="" disabled>انتخاب کنید</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>{r.nameFa}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="دامنه" required>
        {(p) => (
          <Select {...p} value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)}>
            {(["tenant", "unit_tree", "unit"] as const).map((s) => (
              <option key={s} value={s}>{SCOPE_TYPE[s]}</option>
            ))}
          </Select>
        )}
      </Field>
      {scopeType !== "tenant" && (
        <Field label="واحد" required>
          {(p) => (
            <Select {...p} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="" disabled>انتخاب کنید</option>
              {flat.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="اعتبار تا (اختیاری)" hint="برای نقش موقت، مثلاً داور مهمان یا تفویض.">
        {(p) => <Input {...p} type="date" dir="ltr" value={validTo} onChange={(e) => setValidTo(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
