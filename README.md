# Uni platform

Multi-tenant university process platform (spec: `docs/spec/scenario-v0.2.txt`, SRS v0.2).

```
apps/api         NestJS 12 + Drizzle + PostgreSQL RLS  (phase 1 core: done)
apps/web         Next.js — student / faculty / reviewer / public  (todo)
apps/backoffice  Next.js — platform admin + university admin     (todo)
packages/*       shared UI, API client generated from OpenAPI    (todo)
```

## Run locally

```bash
pnpm install
pnpm infra:up                          # postgres:55432 redis:56379 minio:59000 mailpit:58025
cp apps/api/.env.example apps/api/.env
pnpm --filter @uni/api db:migrate
pnpm --filter @uni/api db:seed         # platform admin from SEED_PLATFORM_ADMIN_*
pnpm --filter @uni/api dev             # http://localhost:4000, OpenAPI at /docs
pnpm --filter @uni/api test            # uses database uni_test, Redis db 15
```

ClamAV is behind a compose profile (`docker compose --profile scan up -d clamav`, then
`FILE_SCAN_MODE=clamav`). Production refuses `FILE_SCAN_MODE=skip`.

## Key design decisions (API)

- **Tenant isolation in the database** (TEN-02): every tenant table has `tenant_id` + RLS.
  Request traffic uses role `uni_app` (no BYPASSRLS); each request runs in one transaction with
  `app.tenant_id` / `app.user_id` set (`TxInterceptor`). `uni_system` (BYPASSRLS) is used only
  explicitly: workers, OTP counters, detached audit writes.
- **Tenant resolution**: `X-Tenant: <slug>` header or `<slug>.<TENANT_BASE_DOMAIN>` / custom domain.
- **Access path** (section 5): `AuthGuard` → `TenantGuard` (tenant status, membership) →
  `PermissionGuard` (`@RequirePermission`, any scope) → service-level `AclService.assert` for the
  resource's unit/case scope. Default deny; denials are audited.
- **Roles**: permission catalog in code (`permissions.catalog.ts`), templates copied to each
  tenant; assignments carry scope (`tenant | unit | unit_tree | case`) and validity window.
- **Audit**: append-only (`REVOKE` + trigger), per-tenant SHA-256 hash chain computed in a DB
  trigger; `GET /v1/admin/audit/verify` detects tampering.
- **Auth**: OTP (6 digits, 150 s, 5 attempts, resend gap, per mobile/IP/tenant limits), Argon2id,
  15-min access JWT + rotating refresh token with reuse detection, per-IP lockout.
- **Files**: private MinIO bucket, content sniffing, quota, async ClamAV scan, single-use 60 s
  download links, confidential views audited.
- **Outbox**: events written in the business transaction, dispatched by a poller (phase-1 SMS only).
- Error body is always `{ error: { code, message, details? }, requestId }`; codes in
  `src/common/errors/app-error.ts`.

## Phase 1 — not done yet

- Frontends: `apps/backoffice`, `apps/web` (RTL, Jalali, WCAG AA).
- AUTH-16 bulk Excel import, AUTH-12 2FA for admins, FIL-09 retention jobs, AUD-07 retention.
- Real SMS provider adapter (only console/memory now) and signed tenant header behind a BFF.
