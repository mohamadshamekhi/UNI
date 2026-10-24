import { clsx } from "clsx";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-semibold text-gold">
            <span aria-hidden className="h-px w-5 bg-gold" />
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-black tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const SURFACE = "rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-20px_rgb(15_23_42/0.18)]";

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx(SURFACE, className)} aria-label={title}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
          {title && <h2 className="text-sm font-bold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className={clsx(SURFACE, "overflow-x-auto")}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={clsx("border-b border-border bg-muted/60 px-4 py-2.5 text-start text-xs font-semibold text-muted-foreground first:rounded-ss-2xl last:rounded-se-2xl", className)}>
    {children}
  </th>
);

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx("border-b border-border px-4 py-3 align-middle [tr:last-child_&]:border-b-0", className)}>{children}</td>
);

export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 text-sm break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
