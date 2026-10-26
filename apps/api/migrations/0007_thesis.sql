-- Phase 3: drafts, targeted revision, duplicate-title hints and the thesis record (THS-01..12).

-- THS-01: a case can be saved as a draft before it enters the workflow
ALTER TABLE cases DROP CONSTRAINT cases_status_category_check;
ALTER TABLE cases ADD CONSTRAINT cases_status_category_check
  CHECK (status_category IN ('draft', 'open', 'revising', 'success', 'failure', 'cancelled'));
ALTER TABLE cases ADD COLUMN submitted_at timestamptz;
UPDATE cases SET submitted_at = created_at;

-- THS-07: request-form fields the applicant may change in this revision (empty = all)
ALTER TABLE case_tasks ADD COLUMN revision_fields text[] NOT NULL DEFAULT '{}';

-- THS-12: similar titles within a tenant and request type
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX cases_title_trgm_idx ON cases USING gin (title gin_trgm_ops);

-- پرونده تحصیلی: one record per thesis case, synced from case data by a system step
CREATE TABLE theses (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  case_id                   uuid NOT NULL,
  student_membership_id     uuid NOT NULL,
  unit_id                   uuid,
  title_fa                  text NOT NULL,
  title_en                  text,
  degree                    text,
  research_type             text,
  advisor_membership_id     uuid,
  co_advisor_membership_id  uuid,
  reviewer_membership_ids   uuid[] NOT NULL DEFAULT '{}',
  status                    text NOT NULL DEFAULT 'proposal'
                            CHECK (status IN ('proposal', 'in_progress', 'defense_scheduled', 'defended', 'failed', 'cancelled')),
  defense_at                timestamptz,
  defense_place             text,
  grade                     numeric(4, 2) CHECK (grade IS NULL OR (grade >= 0 AND grade <= 20)),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id),
  FOREIGN KEY (tenant_id, student_membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, advisor_membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, co_advisor_membership_id) REFERENCES memberships (tenant_id, id)
);
CREATE INDEX theses_student_idx ON theses (tenant_id, student_membership_id);
CREATE INDEX theses_advisor_idx ON theses (tenant_id, advisor_membership_id);

ALTER TABLE theses ENABLE ROW LEVEL SECURITY;
ALTER TABLE theses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON theses USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON theses TO uni_app, uni_system;
