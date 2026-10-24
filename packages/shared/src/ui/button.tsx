"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-[0_6px_16px_-8px_var(--primary)] hover:bg-primary-hover",
  secondary: "border border-border bg-card text-foreground shadow-sm hover:border-[color-mix(in_oklab,var(--primary)_35%,var(--border))] hover:bg-muted/60",
  ghost: "text-foreground hover:bg-muted",
  danger: "bg-danger text-white shadow-[0_6px_16px_-8px_var(--danger)] hover:opacity-90",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** lg = 44px touch target for mobile-first public pages */
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, disabled, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,opacity] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-11 px-5 text-base" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
