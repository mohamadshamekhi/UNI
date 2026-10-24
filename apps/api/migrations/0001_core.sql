-- Phase 1 core schema: tenancy, identity, org structure, membership, ACL, files, audit, outbox.
-- Tenant-owned tables carry tenant_id and are protected by RLS (see bottom of file).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- global identity
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile            text NOT NULL UNIQUE CHECK (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  email             text UNIQUE CHECK (email = lower(email)),
  password_hash     text,
  full_name         text NOT NULL,
  national_id_hash  text,
  kind              text NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'guest')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  mobile_verified_at timestamptz,
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_national_id_hash_uq ON users (national_id_hash) WHERE national_id_hash IS NOT NULL;

CREATE TABLE platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile       text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('login', 'register', 'reset_password', 'verify_mobile')),
  code_hash    text NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_ip   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_lookup_idx ON otp_challenges (mobile, purpose, created_at DESC);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id),
  refresh_hash       text NOT NULL,
  prev_refresh_hash  text,
  user_agent         text,
  ip                 text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoke_reason      text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- tenancy
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  name_fa         text NOT NULL,
  name_en         text,
  domain          text UNIQUE CHECK (domain = lower(domain)),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended', 'archived')),
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_modules text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- org structure (TEN-11..16)
CREATE TABLE org_unit_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  key              text NOT NULL CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name_fa          text NOT NULL,
  name_en          text,
  is_faculty_level boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE org_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  parent_id  uuid,
  type_id    uuid NOT NULL,
  name_fa    text NOT NULL,
  name_en    text,
  code       text,
  -- materialized path of ancestor ids, '/a/b/c/' (includes self) for subtree checks
  path       text NOT NULL,
  depth      int NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES org_units (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES org_unit_types (tenant_id, id)
);
CREATE INDEX org_units_parent_idx ON org_units (tenant_id, parent_id);
CREATE INDEX org_units_path_idx ON org_units (tenant_id, path text_pattern_ops);
CREATE UNIQUE INDEX org_units_code_uq ON org_units (tenant_id, code) WHERE code IS NOT NULL;

-- ---------------------------------------------------------------- membership (AUTH-*)
CREATE TABLE memberships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  user_id            uuid NOT NULL REFERENCES users (id),
  kind               text NOT NULL CHECK (kind IN ('student', 'faculty', 'staff', 'guest')),
  status             text NOT NULL CHECK (status IN ('draft', 'pending_review', 'needs_revision', 'active', 'rejected', 'suspended', 'ended')),
  member_no          text,
  profile            jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_unit_id     uuid,
  revision_request   jsonb,
  revision_deadline  timestamptz,
  decision_reason    text,
  submitted_at       timestamptz,
  decided_at         timestamptz,
  decided_by         uuid REFERENCES users (id),
  valid_from         timestamptz,
  valid_to           timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, review_unit_id) REFERENCES org_units (tenant_id, id)
);
CREATE UNIQUE INDEX memberships_member_no_uq ON memberships (tenant_id, member_no) WHERE member_no IS NOT NULL;
CREATE INDEX memberships_queue_idx ON memberships (tenant_id, status, review_unit_id, submitted_at);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE membership_units (
  tenant_id     uuid NOT NULL,
  membership_id uuid NOT NULL,
  unit_id       uuid NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, unit_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES org_units (tenant_id, id)
);
CREATE UNIQUE INDEX membership_units_primary_uq ON membership_units (membership_id) WHERE is_primary;

-- case history of a membership request; append-only (AUTH-14, AUD-01..03)
CREATE TABLE membership_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  membership_id uuid NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users (id),
  type          text NOT NULL,
  from_status   text,
  to_status     text,
  public_note   text,
  internal_note text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id)
);
CREATE INDEX membership_events_idx ON membership_events (membership_id, occurred_at);

-- ---------------------------------------------------------------- files (FIL-*)
CREATE TABLE file_objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  owner_user_id    uuid REFERENCES users (id),
  -- set for uploads made before an account exists (registration), sha256 of verified mobile
  upload_subject   text,
  purpose          text NOT NULL,
  original_name    text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  sha256           text NOT NULL,
  storage_key      text NOT NULL UNIQUE,
  scan_status      text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected', 'error', 'skipped')),
  scanned_at       timestamptz,
  linked_type      text,
  linked_id        uuid,
  is_confidential  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX file_objects_link_idx ON file_objects (tenant_id, linked_type, linked_id);

-- ---------------------------------------------------------------- ACL (ACL-*)
CREATE TABLE permissions (
  code        text PRIMARY KEY,
  module      text NOT NULL,
  description text NOT NULL,
  platform_only boolean NOT NULL DEFAULT false
);

-- tenant_id NULL = system template (read-only for tenants, copied on tenant creation)
CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenants (id),
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]{2,60}$'),
  name_fa      text NOT NULL,
  name_en      text,
  description  text,
  template_key text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE UNIQUE INDEX roles_tenant_key_uq ON roles (tenant_id, key) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX roles_template_key_uq ON roles (key) WHERE tenant_id IS NULL;

CREATE TABLE role_permissions (
  role_id         uuid NOT NULL REFERENCES roles (id),
  tenant_id       uuid REFERENCES tenants (id),
  permission_code text NOT NULL REFERENCES permissions (code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE role_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  membership_id  uuid NOT NULL,
  role_id        uuid NOT NULL REFERENCES roles (id),
  scope_type     text NOT NULL CHECK (scope_type IN ('tenant', 'unit', 'unit_tree', 'case')),
  scope_id       uuid,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  granted_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES users (id),
  revoke_reason  text,
  CHECK ((scope_type = 'tenant') = (scope_id IS NULL)),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id)
);
CREATE INDEX role_assignments_membership_idx ON role_assignments (tenant_id, membership_id) WHERE revoked_at IS NULL;
CREATE INDEX role_assignments_role_idx ON role_assignments (role_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- audit (AUD-04..07)
CREATE TABLE audit_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id           uuid REFERENCES tenants (id),
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  actor_type          text NOT NULL CHECK (actor_type IN ('user', 'system')),
  actor_user_id       uuid,
  actor_membership_id uuid,
  action              text NOT NULL,
  target_type         text,
  target_id           text,
  before              jsonb,
  after               jsonb,
  result              text NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  reason              text,
  ip                  text,
  user_agent          text,
  request_id          text,
  prev_hash           text,
  hash                text NOT NULL
);
CREATE INDEX audit_logs_tenant_time_idx ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (tenant_id, actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (tenant_id, target_type, target_id);

-- Hash chain per tenant (NULL tenant = platform chain). SECURITY DEFINER so it can read the
-- previous row regardless of the caller's RLS visibility.
CREATE FUNCTION audit_logs_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || coalesce(NEW.tenant_id::text, 'platform')));
  SELECT hash INTO last_hash FROM audit_logs
   WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
   ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.hash := encode(digest(
    coalesce(last_hash, '') || '|' || NEW.id::text || '|' || coalesce(NEW.tenant_id::text, '') || '|' ||
    to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    NEW.actor_type || '|' || coalesce(NEW.actor_user_id::text, '') || '|' || NEW.action || '|' ||
    coalesce(NEW.target_type, '') || '|' || coalesce(NEW.target_id, '') || '|' ||
    coalesce(NEW.before::text, '') || '|' || coalesce(NEW.after::text, '') || '|' ||
    NEW.result || '|' || coalesce(NEW.reason, ''), 'sha256'), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_logs_chain_trg BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER membership_events_immutable BEFORE UPDATE OR DELETE ON membership_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Recomputes the chain; returns the first broken row (or nothing when intact).
CREATE FUNCTION audit_verify_chain(p_tenant uuid)
RETURNS TABLE (broken_id uuid, broken_seq bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  prev text := NULL;
  expected text;
BEGIN
  FOR r IN SELECT * FROM audit_logs WHERE tenant_id IS NOT DISTINCT FROM p_tenant ORDER BY seq LOOP
    expected := encode(digest(
      coalesce(prev, '') || '|' || r.id::text || '|' || coalesce(r.tenant_id::text, '') || '|' ||
      to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      r.actor_type || '|' || coalesce(r.actor_user_id::text, '') || '|' || r.action || '|' ||
      coalesce(r.target_type, '') || '|' || coalesce(r.target_id, '') || '|' ||
      coalesce(r.before::text, '') || '|' || coalesce(r.after::text, '') || '|' ||
      r.result || '|' || coalesce(r.reason, ''), 'sha256'), 'hex');
    IF r.hash IS DISTINCT FROM expected OR r.prev_hash IS DISTINCT FROM prev THEN
      broken_id := r.id; broken_seq := r.seq; RETURN NEXT; RETURN;
    END IF;
    prev := r.hash;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- outbox (NTF-04/05 foundation)
CREATE TABLE outbox_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid REFERENCES tenants (id),
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  available_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE dispatched_at IS NULL;

-- ---------------------------------------------------------------- RLS
-- app.tenant_id / app.user_id are set per transaction with set_config(..., true).
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_unit_types', 'org_units', 'membership_units', 'membership_events',
                           'file_objects', 'role_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- memberships: tenant isolation, plus a user may read their own memberships across tenants
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY own_rows_read ON memberships FOR SELECT USING (user_id = app_user_id());

-- roles / role_permissions: templates (tenant_id NULL) are readable, writes only within tenant
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY read_templates ON roles FOR SELECT USING (tenant_id IS NULL);
CREATE POLICY tenant_isolation ON roles USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY read_templates ON role_permissions FOR SELECT USING (tenant_id IS NULL);
CREATE POLICY tenant_isolation ON role_permissions USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

-- audit: read own tenant only; insert for own tenant or the platform chain (login events etc.)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON audit_logs FOR SELECT USING (tenant_id = app_tenant_id());
CREATE POLICY tenant_insert ON audit_logs FOR INSERT WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant_id());

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_insert ON outbox_events FOR INSERT WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant_id());

-- ---------------------------------------------------------------- grants
GRANT USAGE ON SCHEMA public TO uni_app, uni_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uni_app, uni_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uni_app, uni_system;
REVOKE UPDATE, DELETE ON audit_logs, membership_events FROM uni_app, uni_system;
REVOKE SELECT, UPDATE, DELETE ON outbox_events FROM uni_app;
REVOKE INSERT, UPDATE, DELETE ON permissions FROM uni_app;
REVOKE DELETE ON users, tenants, memberships, roles, role_assignments, org_units FROM uni_app;
