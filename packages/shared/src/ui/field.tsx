"use client";

import { clsx } from "clsx";
import { useId, type ComponentProps, type InputHTMLAttributes, type ReactNode } from "react";

const control =
  "w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-150 focus:border-primary aria-[invalid=true]:border-danger disabled:opacity-60";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; required?: boolean }) => ReactNode;
  className?: string;
}

/** Visible label, hint and inline error wired with aria (forms rules: label + error near field). */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, required })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={clsx(control, "h-10", className)} {...p} />;

export const Select = ({ className, ...p }: ComponentProps<"select">) => <select className={clsx(control, "h-10", className)} {...p} />;

export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => (
  <textarea className={clsx(control, "min-h-24 py-2", className)} {...p} />
);

export function Checkbox({ label, description, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1 size-4 cursor-pointer accent-[var(--primary)]" {...p} />
      <label htmlFor={id} className="cursor-pointer text-sm">
        <span>{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </label>
    </div>
  );
}
