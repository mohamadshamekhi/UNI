# Phase 6 — Payment and reports (sections 12 and 15, PAY-01..13, AUD-08..10)

Gates:
- Payment: a repeated callback / submission with the same idempotency key creates one transaction, one
  receipt and one workflow move; the daily reconciliation shows no mismatch.
- Reports: every report is limited by tenant, unit and role; confidential data only with permission;
  exports need their own permission and are audited.

## Payment

Payment is an independent module (PAY-01). Other modules never talk to a bank; they create a
**payment request** and react to `payment.succeeded` / `payment.failed` domain events.

| Table | Purpose |
|---|---|
| `fee_schedules` | tariff per service key (e.g. `thesis.defense`, `event:<id>`), versioned with `effective_from` (PAY-10); amount in rials, `bigint` |
| `payment_requests` | reason, payer (user + membership), amount copied from the tariff **at creation** (PAY-02, never from the browser), reference (`case` / `event_registration`), status, `expires_at`, idempotency key, tracking code |
| `payment_transactions` | each attempt on a request (PAY: «multiple attempts»): gateway, authority / reference id, amount, status, gateway error code + message (PAY-13), raw verify response **without** card data (PAY-04) |
| `payment_receipts` | one per succeeded request (unique), receipt number |
| `payment_events` | history (immutable) |
| `gateway_configs` | per tenant: adapter key, merchant id (secret stored encrypted), active flag (PAY-03) |

Statuses: `created → pending → succeeded | failed | cancelled | review`, `refunded` (later, PAY-12).
`failed` allows a new attempt; `review` = unknown result, a finance officer decides.

Flow:
1. Workflow `payment` step (new step type, PAY-08) or event registration with a fee creates a request.
   The case stays at the step until `succeeded`; the step has a deadline (expire → `cancelled` →
   failure transition).
2. Payer starts an attempt → adapter `start()` returns a redirect URL (no card data ever enters).
3. Callback is only a hint. The server calls adapter `verify()`; amount and reference must match the
   request (PAY-05). A row lock + unique keys make it idempotent (PAY-06): second callback returns the
   stored result.
4. Success: atomic status change, receipt, outbox `payment.succeeded` → workflow advances the case.
5. Reconciliation job (PAY-07) every 10 minutes re-verifies `pending` attempts older than 15 minutes
   and moves unknown ones to `review`; a daily job compares totals with the gateway report.

Gateway adapters (PAY-03): one interface (`start`, `verify`, `inquire`, optional `refund`). Shipped now:
`sandbox` (development only: a simulated bank page that can succeed, fail or hang). The real Iranian
gateway adapter (bank/PSP chosen by the university contract) is added when the contract and merchant
details are known.

Permissions: `payment.view` (exists), new `payment.manage` (tariffs, gateway config, review decisions),
`report.export` (AUD-09).

## Reports (management dashboard)

Computed from operational tables with tenant RLS and the viewer's unit scope (AUD-08); heavy queries go
through a read-only connection that can point at a replica later (AUD-10).

| Report | Measure |
|---|---|
| Cases by status | count per status category, filter type / unit / period |
| Open cases | by assignee and step |
| Step durations | mean and median time spent per step (from case events) |
| Overdue cases | open tasks past SLA with delay |
| Memberships | registered / approved / rejected, mean approval time |
| Papers | accepted / rejected by degree and unit (no reviewer or author identity, AUD-11) |
| News | published posts and views (anonymous counter, no viewer identity) |
| Events | registrations per event, by home university / membership kind |
| Finance (PAY-11) | paid / failed / review totals per service and period |

Exports: CSV (UTF-8 BOM) and XLSX, only with `report.export`, every export written to the audit log.

## As built (notes)

- Paid events: the organiser sets a price on the event; it becomes the versioned tariff `event:<id>`.
  A registration holds its seat as `awaiting_payment` for up to 48 hours (or until the registration
  deadline); paying confirms it, and an expired or cancelled request releases the seat to the waitlist.
- The receipt is a print page; "save as PDF" in the print dialog produces the file.
- Reports run on the primary database under RLS for now; `AUD-10` (replica / aggregate tables) is a
  connection-string change when a replica exists.
- Background handlers run through `DbService.background()` (one RLS transaction plus a request
  context), so the outbox and audit write in the same transaction.
