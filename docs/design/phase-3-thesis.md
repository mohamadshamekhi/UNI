# Phase 3 — Thesis (section 8, THS-01..13)

Gate (section 21): one thesis goes from definition to recorded grade without the technical team. Everything is
built on the phase-2 engine; the thesis-specific parts are a few generic engine features plus a thesis record.

## 1. Generic engine features (usable by any workflow)

| Need | Design |
|---|---|
| Draft then submit (THS-01) | `cases.status_category = 'draft'`; `POST /v1/cases {draft:true}` stores data without entering the workflow; `PATCH /v1/cases/:id/draft`, `POST /v1/cases/:id/submit` validates the request form then starts. Drafts are visible to the applicant only. |
| Member fields (THS-02/04) | form field type `member` with `eligibility {role, scope: tenant\|case_unit\|case_unit_tree}`; value = membership id. Server checks the chosen member holds the role in scope, is active and is not the applicant. `GET /v1/cases/eligible-members?requestType&field` lists candidates with load/capacity. |
| Supervision capacity (THS-04) | field option `capacity: {default: n}`; per-member override in `membership.profile.supervisionCapacity`. Load = open/revising/success-not-closed cases whose data[field] = member. Full members are shown disabled and rejected on submit. |
| One active request (THS-05) / reapply (THS-11) | definition `limits: {onePerApplicant?: bool, reapplyAfterDays?: n}`; checked at submit against the applicant's cases of the same request type. |
| Targeted revision (THS-07) | `return_for_fix` may carry `revision: {fields[], deadlineDays}`: the applicant task gets that due date and only those request-form fields may change; each resubmission stores the previous values in the event (`form.previous`) so versions are kept. |
| Withdraw (THS-10) | applicant withdraw allowed while any current step has `allowWithdraw: true` (human steps) or the case is revising. |
| Duplicate title (THS-12) | `pg_trgm` similarity on `cases.title` within tenant & request type; staff view lists similar titles (≥ 0.5). |

## 2. Thesis record (پرونده تحصیلی)

`theses` table: tenant, case_id, student_membership_id, title_fa, title_en, degree, research_type, advisor /
co-advisor membership ids, reviewers (membership ids), status (`proposal → in_progress → defense_scheduled →
defended | failed | cancelled`), defense_at, defense_place, grade (0–20), grade_label, timestamps.

A `system` step `{task: 'thesis', params: {status}}` syncs the record from case data (keys: `title`, `titleEn`,
`degree`, `researchType`, `advisorId`, `coAdvisorId`, `reviewers`, `defenseAt`, `defensePlace`, `grade`) — so the
university models proposal, defense scheduling and grading as ordinary steps and forms. The grade label follows
the usual scale (۱۹–۲۰ عالی، ۱۷–۱۸٫۹۹ بسیار خوب، ۱۵–۱۶٫۹۹ خوب، ۱۴–۱۴٫۹۹ قابل قبول، < ۱۴ مردود).

Views: backoffice «پایان‌نامه‌ها» (scoped list + detail), advisor «دانشجویان من» (supervisions + capacity),
portal «پرونده تحصیلی» (student's theses, status, advisor, defense, grade). Staff action «تغییر استاد راهنما»
(THS-09, `case.assign`, reason) updates the case and record and moves open advisor tasks.

## 3. Template

«پایان‌نامه کامل» template: proposal form (title fa/en, degree, field, abstract, keywords, advisor [member,
capacity], co-advisor, research type, proposal file) → expert completeness check → advisor acceptance →
(phd: committee review) → final approval → system thesis(in_progress) → defense scheduling (reviewers, date,
place) → system thesis(defense_scheduled) → defense & grade (final file, similarity report, grade) → system
thesis(defended) → end.

## 4. Status timeline (THS-06)

Portal case page shows the definition's main path as a stepper (done / current / upcoming), the current
responsible, due date and the action needed from the student.

THS-13 (official PDF form) is «ط» — deferred.
