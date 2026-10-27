"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { api } from "@uni/shared/api";
import { fmtDate, toFaDigits } from "@uni/shared/format";
import { REVIEW_STATUS } from "@uni/shared/labels";
import { Badge } from "@uni/shared/ui/badge";
import { PageHeader, Table, Td, Th } from "@uni/shared/ui/layout";
import { EmptyState, QueryView } from "@uni/shared/ui/states";
import type { ReviewStatus } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

interface Row {
  id: string;
  status: ReviewStatus;
  round: number;
  due_at: string;
  title: string;
  track_name: string;
}

/** Reviews the user was invited to; the author is never shown here. */
export default function MyReviewsPage() {
  const slug = useSlug();
  const q = useQuery({ queryKey: ["my-reviews", slug], queryFn: () => api<Row[]>("/v1/me/reviews", { tenant: slug }) });
  return (
    <>
      <PageHeader eyebrow="کار من" title="داوری‌های من" description="دعوت‌ها و مقالاتی که داوری آن‌ها به شما سپرده شده است." />
      <QueryView query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={ClipboardCheck} title="دعوت داوری ندارید" />}>
        {(rows) => (
          <Table caption="داوری‌های من">
            <thead>
              <tr>
                <Th>مقاله</Th>
                <Th>روند</Th>
                <Th>دور</Th>
                <Th>وضعیت</Th>
                <Th>مهلت</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/60">
                  <Td>
                    <Link href={`/t/${slug}/reviews/${r.id}`} className="font-medium text-primary hover:underline">{r.title}</Link>
                  </Td>
                  <Td>{r.track_name}</Td>
                  <Td className="tabular">{toFaDigits(String(r.round))}</Td>
                  <Td><Badge tone={REVIEW_STATUS[r.status].tone}>{REVIEW_STATUS[r.status].label}</Badge></Td>
                  <Td className="tabular whitespace-nowrap">{fmtDate(r.due_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryView>
    </>
  );
}
