-- Phase 4: papers and peer review (section 9, PAP-01..14).

CREATE TABLE paper_tracks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  name_fa             text NOT NULL,
  description         text,
  review_mode         text NOT NULL CHECK (review_mode IN ('open', 'single_blind', 'double_blind')),
  max_rounds          int NOT NULL DEFAULT 3 CHECK (max_rounds BETWEEN 1 AND 10),
  reviewer_days       int NOT NULL DEFAULT 14 CHECK (reviewer_days BETWEEN 1 AND 120),
  min_reviewers       int NOT NULL DEFAULT 2 CHECK (min_reviewers BETWEEN 1 AND 10),
  reviewer_download   boolean NOT NULL DEFAULT true,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE papers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  track_id               uuid NOT NULL,
  tracking_code          text,
  author_membership_id   uuid NOT NULL,
  manager_membership_id  uuid,
  review_mode            text NOT NULL CHECK (review_mode IN ('open', 'single_blind', 'double_blind')),
  title                  text NOT NULL,
  abstract               text,
  keywords               text[] NOT NULL DEFAULT '{}',
  degree                 text NOT NULL,
  field                  text,
  co_authors             jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicts              jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft', 'submitted', 'under_review', 'reviews_done', 'revision_requested', 'revised',
                           'accepted_conditional', 'accepted', 'rejected', 'withdrawn')),
  round                  int NOT NULL DEFAULT 0,
  revision_due_at        timestamptz,
  decision               text,
  decision_note          text,
  lock_version           int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  submitted_at           timestamptz,
  decided_at             timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, tracking_code),
  FOREIGN KEY (tenant_id, track_id) REFERENCES paper_tracks (tenant_id, id),
  FOREIGN KEY (tenant_id, author_membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, manager_membership_id) REFERENCES memberships (tenant_id, id)
);
CREATE INDEX papers_author_idx ON papers (tenant_id, author_membership_id);
CREATE INDEX papers_status_idx ON papers (tenant_id, status);
CREATE SEQUENCE paper_tracking_seq;

CREATE TABLE paper_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  paper_id           uuid NOT NULL,
  round              int NOT NULL,
  original_file_id   uuid NOT NULL,
  review_file_id     uuid,
  scrub_report       jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_letter    text,
  response_file_id   uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, round),
  FOREIGN KEY (tenant_id, paper_id) REFERENCES papers (tenant_id, id)
);

CREATE TABLE paper_guests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  full_name        text NOT NULL,
  mobile           text,
  email            text,
  token_hash       text NOT NULL UNIQUE,
  token_used_at    timestamptz,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  created_by       uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE paper_reviews (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  paper_id                 uuid NOT NULL,
  round                    int NOT NULL,
  reviewer_membership_id   uuid,
  guest_id                 uuid,
  alias_no                 int NOT NULL,
  status                   text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined', 'submitted', 'cancelled')),
  due_at                   timestamptz NOT NULL,
  invited_at               timestamptz NOT NULL DEFAULT now(),
  responded_at             timestamptz,
  submitted_at             timestamptz,
  decline_reason           text,
  recommendation           text CHECK (recommendation IN ('accept', 'accept_conditional', 'minor_revision', 'major_revision', 'reject')),
  comments_to_author       text,
  confidential_comments    text,
  scores                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachment_file_id       uuid,
  conflicts_acknowledged   jsonb,
  reminded_at              timestamptz,
  FOREIGN KEY (tenant_id, paper_id) REFERENCES papers (tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_membership_id) REFERENCES memberships (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES paper_guests (tenant_id, id),
  CHECK ((reviewer_membership_id IS NULL) <> (guest_id IS NULL))
);
CREATE INDEX paper_reviews_paper_idx ON paper_reviews (paper_id, round);
CREATE INDEX paper_reviews_reviewer_idx ON paper_reviews (tenant_id, reviewer_membership_id) WHERE reviewer_membership_id IS NOT NULL;
CREATE INDEX paper_reviews_due_idx ON paper_reviews (due_at) WHERE status IN ('invited', 'accepted');

-- audience: everyone involved sees 'all'; 'author', 'reviewers' or 'managers' only for that audience
CREATE TABLE paper_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  paper_id             uuid NOT NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  actor_user_id        uuid REFERENCES users (id),
  actor_guest_id       uuid,
  type                 text NOT NULL,
  round                int NOT NULL,
  audience             text NOT NULL CHECK (audience IN ('all', 'author', 'reviewers', 'managers')),
  note                 text,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id, paper_id) REFERENCES papers (tenant_id, id)
);
CREATE INDEX paper_events_paper_idx ON paper_events (paper_id, occurred_at);
CREATE TRIGGER paper_events_immutable BEFORE UPDATE OR DELETE ON paper_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['paper_tracks', 'papers', 'paper_versions', 'paper_guests', 'paper_reviews', 'paper_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON paper_tracks, papers, paper_versions, paper_guests, paper_reviews TO uni_app, uni_system;
GRANT SELECT, INSERT ON paper_events TO uni_app, uni_system;
GRANT USAGE ON SEQUENCE paper_tracking_seq TO uni_app, uni_system;
