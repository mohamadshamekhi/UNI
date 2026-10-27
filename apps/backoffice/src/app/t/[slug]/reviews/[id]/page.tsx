"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@uni/shared/api";
import { openFile } from "@uni/shared/ui/form-fields";
import { ReviewWorkspace } from "@uni/shared/ui/review-workspace";
import { QueryView } from "@uni/shared/ui/states";
import type { ReviewerPaperView } from "@uni/shared/types";
import { useSlug } from "@/lib/hooks";

export default function ReviewPage() {
  const slug = useSlug();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["review", slug, id], queryFn: () => api<ReviewerPaperView>(`/v1/reviews/${id}`, { tenant: slug }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["review", slug, id] });
    qc.invalidateQueries({ queryKey: ["my-reviews", slug] });
  };
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/t/${slug}/reviews`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight aria-hidden className="size-4" />
        داوری‌های من
      </Link>
      <QueryView query={q}>
        {(view) => (
          <ReviewWorkspace
            view={view}
            onChanged={refresh}
            actions={{
              accept: () => api(`/v1/reviews/${id}/accept`, { method: "POST", tenant: slug }),
              decline: (reason) => api(`/v1/reviews/${id}/decline`, { method: "POST", tenant: slug, body: { reason: reason || undefined } }),
              submit: (body) => api(`/v1/reviews/${id}/submit`, { method: "POST", tenant: slug, body }),
              download: async () => {
                if (!view.manuscript?.fileId) throw new Error("فایل در دسترس نیست.");
                await openFile(slug, view.manuscript.fileId);
              },
              upload: (file) => {
                const fd = new FormData();
                fd.set("purpose", "paper_review_attachment");
                fd.set("file", file);
                return api<{ id: string }>("/v1/files", { method: "POST", tenant: slug, body: fd });
              },
            }}
          />
        )}
      </QueryView>
    </div>
  );
}
