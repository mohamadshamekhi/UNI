"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CircleAlert, Inbox, ListTodo } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@uni/shared/api";
import { fmtDate, fmtNum } from "@uni/shared/format";
import { caseRef, DueBadge } from "@uni/shared/ui/case";
import { Checkbox } from "@uni/shared/ui/field";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { CartableTask } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

const SOON = 2 * 86_400_000;

/** Cartable (UX-04): every open task the user can act on, soonest deadline first. */
export default function TasksPage() {
  const slug = useSlug();
  const [lateOnly, setLateOnly] = useState(false);
  const q = useQuery({
    queryKey: ["my-tasks", slug],
    queryFn: () => api<CartableTask[]>("/v1/me/tasks", { tenant: slug }),
    refetchInterval: 60_000,
  });
  // cases the user filed themselves are handled in the portal, not here
  const staffTasks = (q.data ?? []).filter((t) => t.assigneeType !== "applicant");
  const now = Date.now();
  const overdue = staffTasks.filter((t) => t.overdue).length;
  const soon = staffTasks.filter((t) => !t.overdue && t.dueAt && new Date(t.dueAt).getTime() - now < SOON).length;

  return (
    <>
      <PageHeader eyebrow="کار من" title="کارتابل" description="کارهایی که منتظر اقدام شما هستند؛ مرتب‌شده بر اساس نزدیک‌ترین مهلت." />
      <ul className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat icon={ListTodo} label="کارهای باز" value={staffTasks.length} />
        <Stat icon={AlarmClock} label="نزدیک مهلت" value={soon} tone="warning" />
        <Stat icon={CircleAlert} label="گذشته از مهلت" value={overdue} tone="danger" />
      </ul>
      <div className="mb-3">
        <Checkbox label="فقط کارهای گذشته از مهلت" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} />
      </div>
      <QueryView
        query={{ ...q, data: q.data ? staffTasks.filter((t) => !lateOnly || t.overdue) : undefined }}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Inbox} title={lateOnly ? "کار عقب‌افتاده‌ای ندارید" : "کارتابل شما خالی است"} description="کارهای جدید به‌محض ارجاع اینجا و در اعلان‌ها نمایش داده می‌شوند." />}
      >
        {(tasks) => (
          <Table caption="کارهای باز">
            <thead>
              <tr>
                <Th>مرحله</Th>
                <Th>پرونده</Th>
                <Th>فرایند</Th>
                <Th>متقاضی</Th>
                <Th>مهلت</Th>
                <Th>ارجاع</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-muted/60">
                  <Td>
                    <Link href={`/t/${slug}/cases/${t.caseId}`} className="font-medium text-primary hover:underline">
                      {t.step}
                    </Link>
                  </Td>
                  <Td>
                    <span className="block font-mono text-xs text-muted-foreground" dir="ltr">{caseRef(t.caseId)}</span>
                    {t.caseTitle && <span className="block max-w-56 truncate">{t.caseTitle}</span>}
                  </Td>
                  <Td>{t.workflowName}</Td>
                  <Td>
                    {t.applicantName}
                    {t.unitNameFa && <span className="block text-xs text-muted-foreground">{t.unitNameFa}</span>}
                  </Td>
                  <Td>
                    <DueBadge dueAt={t.dueAt} overdue={t.overdue} />
                  </Td>
                  <Td className="tabular whitespace-nowrap">{fmtDate(t.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value: number; tone?: "warning" | "danger" }) {
  const color = tone === "danger" ? "bg-danger-bg text-danger" : tone === "warning" ? "bg-warning-bg text-warning" : "bg-info-bg text-primary";
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span className={`flex size-11 items-center justify-center rounded-xl ${color}`}>
        <Icon aria-hidden className="size-5" />
      </span>
      <div>
        <p className="text-2xl font-black tabular">{fmtNum(value)}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </li>
  );
}
