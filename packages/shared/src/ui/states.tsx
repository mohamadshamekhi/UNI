"use client";

import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "../api";
import { Button } from "./button";

export function Loading({ rows = 4, label = "در حال بارگذاری" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/70" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-info-bg text-primary">
        <Icon aria-hidden className="size-7" strokeWidth={1.6} />
      </span>
      <p className="font-bold">{title}</p>
      {description && <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-danger-bg text-danger">
        <AlertTriangle aria-hidden className="size-7" strokeWidth={1.6} />
      </span>
      <p className="max-w-md text-sm leading-6">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          تلاش دوباره
        </Button>
      )}
    </div>
  );
}

/** Renders loading / error / empty / data for a query result. */
export function QueryView<T>({
  query,
  empty,
  isEmpty,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty && isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
