# Phase 2 — Workflow engine, forms, cartable, SLA, notifications

Scope from SRS section 7 and 13 (WF-01..24, NTF-01..14, UX-04). Acceptance gate: one sample workflow runs
end to end, running cases stay pinned to their version, notifications are delivered.

## 1. Concepts → tables

| Concept | Table | Notes |
|---|---|---|
| Workflow | `workflows` | tenant, key, name, `request_type` (e.g. `thesis_request`), owning unit (nullable = whole tenant) |
| Version | `workflow_versions` | immutable once published; `definition jsonb`, status `draft → validated → tested → published → retired`, `selector jsonb`, `published_at` |
| Case | `cases` | tenant, workflow_version_id (pinned), subject (`request_type`, applicant membership, unit), `state` (current step ids), `status_category` (`open/revising/success/failure`), `data jsonb`, `due_at` |
| Task | `case_tasks` | one per human step activation: step id, assignee rule resolution (role+scope / membership / dynamic), `assignee_membership_id` nullable, `candidate` scope, `due_at`, `remind_at[]`, status `open/done/cancelled/expired`, decision |
| Transition log | `case_events` | append-only: action, from/to step, actor, form submission, public/internal note |
| Form | `form_submissions` | per task/step: `values jsonb`, files linked via `file_objects.linked_type='case'` |
| Holidays | `calendar_holidays` | per tenant (+ national list seeded), for business-day SLAs |
| Notification templates | `notification_templates` | per tenant × event × channel × locale, with allowed variables |
| Notification rules | `notification_rules` | event → recipients (applicant / assignee / role+scope) × channels × timing |
| Deliveries | `notification_deliveries` | per outbox event × recipient × channel, idempotency key, status, provider id, error |
| In-app inbox | `notifications` | user, tenant, title, body, link, read_at |

All tenant tables get `tenant_id` + RLS like phase 1.

## 2. Definition DSL (stored JSON, never code — WF-03)

```json
{
  "steps": [
    { "id": "expert-check", "type": "human", "title": "بررسی کارشناس",
      "assignee": { "role": "expert", "scope": "case_unit_tree" },
      "form": [{ "key": "note", "type": "textarea", "label": "توضیح", "required": false, "visibility": "internal" }],
      "actions": ["approve", "return_for_fix", "reject"],
      "sla": { "days": 5, "businessDays": true, "remindBefore": [2], "onOverdue": "escalate" } },
    { "id": "advisor", "type": "human", "assignee": { "dynamic": "case.data.advisorMembershipId" }, "actions": ["approve", "reject"] },
    { "id": "route", "type": "decision" },
    { "id": "reviews", "type": "parallel", "branches": ["review-a", "review-b"], "join": "all" },
    { "id": "done", "type": "end", "outcome": "success" },
    { "id": "rejected", "type": "end", "outcome": "failure" }
  ],
  "transitions": [
    { "from": "expert-check", "action": "approve", "to": "advisor" },
    { "from": "expert-check", "action": "return_for_fix", "to": "@applicant" },
    { "from": "route", "when": "data.degree == 'phd' || data.needsCommittee", "to": "reviews" },
    { "from": "route", "otherwise": true, "to": "done" }
  ]
}
```

- **Conditions**: a small expression language parsed to an AST and evaluated against a frozen view of
  `{ data, case, actor }`: literals, `== != < <= > >= && || !`, `in`, member access. No function calls,
  no loops, no assignment. Parser is hand-written (no `eval`, no third-party sandbox).
- **`@applicant`**: built-in "return to applicant for revision" pseudo-step (case status category `revising`).
- **Assignee rules** (WF-01): `role + scope` (`tenant`, `case_unit`, `case_unit_tree`, a fixed unit id),
  a specific membership, or `dynamic` path into case data. Resolution creates a task visible to every
  member holding that role in scope (claim optional); SoD rule: the applicant can never be an assignee.

## 3. Validation before publish (WF-14)

Every step reachable from the start; every path reaches an `end`; no unbounded cycle without a human step;
every action of a human step has a transition; roles referenced exist in the tenant; dynamic paths
declared in the request form schema; selectors of published versions for the same `request_type` don't
overlap (WF-08); decision steps have exactly one `otherwise`.

## 4. Runtime

- **Start**: `selector` chooses the version (request type, degree, unit, …; WF-07). Case pinned to it.
- **Act**: `POST /cases/:id/tasks/:taskId/actions {action, form, note}` → server checks the actor can act on
  the task (ACL + task assignment + SoD), validates the form, evaluates transitions, writes events and the
  next tasks in **one transaction** with optimistic locking on `cases.version` (WF-05: double submit → one
  transition wins, the other gets `CONFLICT`).
- **Semantics** (implemented in `apps/api/src/modules/workflow/engine.service.ts`):
  - human action → first transition of that action whose `when` holds, else the unconditional one;
  - `@applicant` → applicant task (`resubmit` with a `data` patch re-enters the sending step, `withdraw` cancels);
  - parallel branches have no transitions of their own; `join: all|any` then follows the parallel's single exit;
  - step form values: `public` fields merge into `data`, `internal` into `case.internal`; the last action per
    step is in `case.decisions.<step_id>` (dashes → underscores) for routing after a join;
  - system steps emit `workflow.<task>` outbox events; end steps close the case and cancel open tasks.
- **SLA** (WF-20..24): `due_at` computed with the tenant calendar; reminders/escalations scheduled as BullMQ
  delayed jobs keyed by task id (idempotent); a periodic sweep re-enqueues anything missed after restarts.
- **Sandbox run** (WF-15): executes a draft version against a simulated case in a rolled-back transaction
  with notifications captured instead of sent; result = visited steps + produced tasks.
- **Impact analysis** (WF-16): count of open cases on the previous version and units affected by the selector.

## 5. Notifications (section 13)

Modules emit domain events through the existing outbox; the notification service resolves rules →
recipients → channel → template → delivery rows (idempotency key per event×recipient×channel, NTF-05),
sends via provider adapters with exponential retry and a dead-letter state (NTF-04/06). SMS templates never
include confidential details (NTF-07); per-tenant SMS quota and quiet hours (NTF-11/13); users can mute
non-critical channels (NTF-10). In-app inbox with unread counter (NTF-09).

## 6. API surface (first cut)

```
Admin (workflow.define / workflow.publish)
  GET/POST   /v1/admin/workflows
  GET/POST   /v1/admin/workflows/:id/versions            (new draft = copy of latest)
  PATCH      /v1/admin/workflow-versions/:id              (draft only)
  POST       /v1/admin/workflow-versions/:id/validate
  POST       /v1/admin/workflow-versions/:id/simulate
  GET        /v1/admin/workflow-versions/:id/impact
  POST       /v1/admin/workflow-versions/:id/publish | /retire
Cases
  POST       /v1/cases                                    (case.create; request_type + data)
  GET        /v1/cases/:id                                (applicant view vs. staff view)
  GET        /v1/me/tasks                                 (cartable across modules, UX-04)
  POST       /v1/cases/:id/tasks/:taskId/actions
  POST       /v1/cases/:id/tasks/:taskId/reassign         (WF-12, reason)
  POST       /v1/cases/:id/tasks/:taskId/extend           (WF-23, reason)
Notifications
  GET        /v1/me/notifications · POST /v1/me/notifications/:id/read · GET/PATCH /v1/me/notification-preferences
  GET/PUT    /v1/admin/notification-templates · /v1/admin/notification-rules · GET /v1/admin/notification-deliveries
```

## 7. UI

- **Backoffice → Workflows**: list per request type; version timeline; visual step editor (list + side panel,
  not a free canvas — easier to keep accessible), transition table, form builder per step, validation panel,
  sandbox runner, impact preview before publish.
- **Cartable** (backoffice and portal): one list of open tasks from every module, sortable by due date, with
  overdue badges; task screen = case summary, form, actions, history.
- **Notification centre**: bell with unread count, inbox page, preferences.

## 8. Delivery order

1. Schema + DSL parser/evaluator + validator (unit-tested in isolation).
2. Runtime: start/act/transition, tasks, SoD, optimistic locking; case history.
3. SLA scheduler + holiday calendar; reminders/escalation.
4. Notification service (rules, templates, deliveries, inbox) replacing the phase-1 hard-coded SMS handlers.
5. Admin API + backoffice workflow designer; cartable in both apps.
6. Sample templates (membership, thesis skeleton) and the phase gate test.
