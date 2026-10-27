"use client";

import { ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@uni/shared/api";
import { Logo } from "@uni/shared/ui/logo";
import { ReviewWorkspace } from "@uni/shared/ui/review-workspace";
import { Loading } from "@uni/shared/ui/states";
import type { ReviewerPaperView } from "@uni/shared/types";

const key = (token: string) => `uni:guest:${token.slice(0, 12)}`;

/**
 * Guest reviewer page (PAP-11). The one-time link becomes a session kept only in this tab; the
 * page shows nothing but this review.
 */
export default function GuestReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<string | null>(null);
  const [view, setView] = useState<ReviewerPaperView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = (() => {
      try {
        return sessionStorage.getItem(key(token));
      } catch {
        return null;
      }
    })();
    if (saved) return setSession(saved);
    api<{ sessionToken: string }>("/v1/guest/sessions", { method: "POST", public: true, body: { token } })
      .then((r) => {
        try {
          sessionStorage.setItem(key(token), r.sessionToken);
        } catch {
          /* private mode: keep it in memory only */
        }
        setSession(r.sessionToken);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token]);

  const headers = useCallback(() => ({ "x-guest-token": session! }), [session]);
  const load = useCallback(() => {
    if (!session) return;
    api<ReviewerPaperView>("/v1/guest/review", { public: true, headers: headers() })
      .then(setView)
      .catch((e) => {
        if (e instanceof ApiError && e.code === "GUEST_LINK_INVALID") {
          try {
            sessionStorage.removeItem(key(token));
          } catch {
            /* ignore */
          }
        }
        setError(errorMessage(e));
      });
  }, [session, headers, token]);
  useEffect(load, [load]);

  const download = async () => {
    const res = await fetch("/api/proxy/v1/guest/review/manuscript", { headers: headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "دریافت فایل ممکن نشد.");
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "manuscript";
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-center gap-2 font-bold">
            <Logo className="size-7" />
            داوری مقاله
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck aria-hidden className="size-4 text-success" />
            دسترسی محدود به همین داوری
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        {error ? (
          <div role="alert" className="rounded-3xl border border-border bg-card p-8 text-center">
            <p className="font-bold">{error}</p>
            <p className="mt-2 text-sm text-muted-foreground">اگر لینک را قبلاً در مرورگر دیگری باز کرده‌اید، از مدیر بررسی لینک تازه بخواهید.</p>
          </div>
        ) : !view ? (
          <Loading />
        ) : (
          <ReviewWorkspace
            view={view}
            onChanged={load}
            actions={{
              accept: () => api("/v1/guest/review/accept", { method: "POST", public: true, headers: headers() }),
              decline: (reason) => api("/v1/guest/review/decline", { method: "POST", public: true, headers: headers(), body: { reason: reason || undefined } }),
              submit: (body) => api("/v1/guest/review/submit", { method: "POST", public: true, headers: headers(), body }),
              download,
              upload: (file) => {
                const fd = new FormData();
                fd.set("file", file);
                return api<{ id: string }>("/v1/guest/review/attachment", { method: "POST", public: true, headers: headers(), body: fd });
              },
            }}
          />
        )}
      </main>
    </div>
  );
}
