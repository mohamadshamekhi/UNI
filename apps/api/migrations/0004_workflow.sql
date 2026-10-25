-- Phase 2: workflow engine runtime (WF-01..24). Definitions are data; cases pin a version.

CREATE TABLE workflows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  key          text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  name_fa      text NOT NULL,
  request_type text NOT NULL CHECK (request_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE workflow_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  workflow_id   uuid NOT NULL,
  version       int NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'published', 'retired')),
  definition    jsonb NOT NULL,
  selector      jsonb NOT NULL,
  issues        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  published_by  uuid REFERENCES users (id),
  retired_at    timestamptz,
  UNIQUE (workflow_id, version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflows (tenant_id, id)
);
CREATE INDEX workflow_versions_published_idx ON workflow_versions (tenant_id, status) WHERE status = 'published';

-- a published version can never be edited again (WF: «نسخه منتشرشده هرگز ویرایش نمی‌شود»)
CREATE FUNCTION workflow_versions_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'retired') AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.selector IS DISTINCT FROM OLD.selector) THEN
    RAISE EXCEPTION 'published workflow versions are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_versions_freeze_trg BEFORE UPDATE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION workflow_versions_freeze();

CREATE TABLE cases (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  workflow_version_id      uuid NOT NULL,
  request_type             text NOT NULL,
  title                    text,
  applicant_membership_id  uuid NOT NULL,
  unit_id                  uuid,
  status_category          text NOT NULL DEFAULT 'open' CHECK (status_category IN ('open', 'revising', 'success', 'failure', 'cancelled')),
  current_steps            text[] NOT NULL DEFAULT '{}',
  -- data: applicant-visible values (request form + public step fields); internal: staff-only step fields
  data                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  internal                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- last action taken on each human step, for routing after a parallel join
  decisions                jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_version             int NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_version_id) REFERENCES workflow_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, applicant_membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES org_units (tenant_id, id)
);
CREATE INDEX cases_applicant_idx ON cases (tenant_id, applicant_membership_id, created_at DESC);
CREATE INDEX cases_status_idx ON cases (tenant_id, status_category, request_type);

CREATE TABLE case_tasks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  case_id                 uuid NOT NULL,
  step_id                 text NOT NULL,
  -- role: any holder of role_key whose assignment covers the case unit; membership: one person;
  -- applicant: returned to the applicant for revision
  assignee_type           text NOT NULL CHECK (assignee_type IN ('role', 'membership', 'applicant')),
  role_key                text,
  scope                   text CHECK (scope IN ('tenant', 'case_unit', 'case_unit_tree')),
  assignee_membership_id  uuid,
  parallel_of             text,
  return_to               text,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  action                  text,
  due_at                  timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  completed_by            uuid REFERENCES users (id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_membership_id) REFERENCES memberships (tenant_id, id),
  CHECK ((assignee_type = 'role') = (role_key IS NOT NULL))
);
CREATE INDEX case_tasks_open_idx ON case_tasks (tenant_id, status, due_at) WHERE status = 'open';
CREATE INDEX case_tasks_case_idx ON case_tasks (case_id);
CREATE INDEX case_tasks_member_idx ON case_tasks (tenant_id, assignee_membership_id) WHERE status = 'open';

-- case history (AUD-01..03): append-only
CREATE TABLE case_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  case_id              uuid NOT NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  actor_user_id        uuid REFERENCES users (id),
  actor_membership_id  uuid,
  type                 text NOT NULL,
  step_id              text,
  action               text,
  to_step              text,
  public_note          text,
  internal_note        text,
  form                 jsonb,
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id)
);
CREATE INDEX case_events_case_idx ON case_events (case_id, occurred_at);
CREATE TRIGGER case_events_immutable BEFORE UPDATE OR DELETE ON case_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflows', 'workflow_versions', 'cases', 'case_tasks', 'case_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON workflows, workflow_versions, cases, case_tasks TO uni_app, uni_system;
GRANT SELECT, INSERT ON case_events TO uni_app, uni_system;
