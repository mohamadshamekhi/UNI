# Phase 4 — Papers and peer review (section 9, PAP-01..14)

Gate: in double-blind review no identity leaks through API responses or reviewer files (automated
"internal penetration" test).

## Why a dedicated module

Paper review needs a variable number of reviewers per round, per-reviewer invitations and deadlines,
rounds with new manuscript versions, and identity masking that depends on the viewer. That is a domain
state machine of its own; it reuses the platform pieces (files, outbox notifications, audit, ACL,
calendar) rather than the generic step engine.

## Data

| Table | Purpose |
|---|---|
| `paper_tracks` | submission tracks per tenant: name, **review mode** (`open`, `single_blind`, `double_blind`), max rounds, default reviewer days, reviewer download allowed |
| `papers` | tracking code (`P-1405-000123`), author, track, **review mode copied and locked at submission** (PAP-09), title, abstract, keywords, degree (required), field, co-authors, declared conflicts, status, round, manager, decision |
| `paper_versions` | one per round: original file, **review copy** (scrubbed), response letter (+ file) |
| `paper_reviews` | one per reviewer per round: member or guest, alias («داور ۱»), status (`invited/accepted/declined/submitted/cancelled`), due date, recommendation, comments to author, confidential comments, scores, attachment |
| `paper_guests` | guest reviewers: name, mobile/email, token hash (one-time link), session expiry, revocation |
| `paper_events` | append-only history with a visibility per audience |

Statuses: `draft → submitted → under_review → reviews_done → (revision_requested → revised → under_review …)
→ accepted | accepted_conditional | rejected`, plus `withdrawn`. Only the service moves them.

## Identity masking (the gate)

Every response is built per audience — never one object filtered in the UI:

| Viewer | Sees author | Sees reviewers | File |
|---|---|---|---|
| author | — | alias only (open mode: names) | own versions |
| reviewer (member/guest) | only in `open` / `single_blind` | never other reviewers | review copy (double-blind) or original |
| manager (`paper.screen` / `paper.decide`) | yes | yes | both |

Leak controls (section 9 table): PDF metadata (Author/Creator/Producer/Title/Subject/Keywords) and DOCX
`docProps/core.xml`, `app.xml`, comment and tracked-change authors are scrubbed into a separate review copy;
review copies get neutral names (`manuscript-r1.pdf`); notifications use audience-specific templates with no
counterparty names; reviewer-facing timestamps are rounded to the day; all access checks are server-side.

## Conflicts of interest (PAP-04)

Warnings when assigning: reviewer is the author or a co-author; reviewer shares the author's primary unit;
reviewer co-authored an earlier paper with the author; the author listed the reviewer as a conflict.
Assigning despite warnings needs `acknowledgeConflicts: true` and is audited.

## Guest reviewers (PAP-11)

Invitation creates a guest + review and sends a one-time link (`/review/<token>`). Opening it exchanges the
token for a short-lived guest session (JWT, `typ=paper_guest`) scoped to that single review; no lists or search.
Expiry and manual revocation are checked on every request; guest actions are audited.

## API (first cut)

```
Author   POST /v1/papers (draft) · PATCH /v1/papers/:id · POST /:id/submit · POST /:id/revision · POST /:id/withdraw
         GET /v1/me/papers · GET /v1/papers/:id (author view)
Reviewer GET /v1/me/reviews · GET /v1/reviews/:id · POST /v1/reviews/:id/accept|decline|submit
Guest    POST /v1/guest/sessions {token} · GET /v1/guest/review · POST /v1/guest/review/accept|decline|submit
Manager  GET /v1/admin/papers · GET /v1/admin/papers/:id · POST /:id/screen · GET /:id/reviewer-candidates
         POST /:id/reviewers · POST /:id/guest-reviewers · POST /v1/admin/reviews/:id/cancel · POST /:id/decision
         GET/POST/PATCH /v1/admin/paper-tracks
```
