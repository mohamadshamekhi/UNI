"use client";

/** Error from the API's uniform body `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** What to do when the session is gone; each app points it at its own login page. */
let onUnauthorized: () => void = () => {
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export interface RequestOptions {
  /** Public calls (OTP, registration) must not bounce to login on 401. */
  public?: boolean;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  tenant?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const qs = opts.query
    ? new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.tenant) headers["x-tenant"] = opts.tenant;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`/api/proxy${path}${qs ? `?${qs}` : ""}`, { method: opts.method ?? "GET", headers, body });
  if (res.status === 401 && !opts.public && typeof window !== "undefined") onUnauthorized();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "INTERNAL", e?.message ?? "خطای غیرمنتظره رخ داد.", e?.details);
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "خطای غیرمنتظره رخ داد.");
