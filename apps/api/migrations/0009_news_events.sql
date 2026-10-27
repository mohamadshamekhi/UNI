-- Phase 5: news (section 10) and events (section 11).

CREATE TABLE news_channels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  name_fa             text NOT NULL,
  description         text,
  unit_id             uuid,
  policy              text NOT NULL DEFAULT 'single' CHECK (policy IN ('direct', 'single', 'multi')),
  approvals_required  int NOT NULL DEFAULT 1 CHECK (approvals_required BETWEEN 1 AND 5),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES org_units (tenant_id, id)
);

CREATE TABLE news_channel_members (
  tenant_id      uuid NOT NULL,
  channel_id     uuid NOT NULL,
  membership_id  uuid NOT NULL,
  role           text NOT NULL CHECK (role IN ('author', 'approver', 'publisher')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, membership_id, role),
  FOREIGN KEY (tenant_id, channel_id) REFERENCES news_channels (tenant_id, id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id)
);

CREATE TABLE news_posts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  channel_id            uuid NOT NULL,
  slug                  text NOT NULL,
  title                 text NOT NULL,
  summary               text,
  body_html             text NOT NULL DEFAULT '',
  cover_file_id         uuid,
  attachment_file_ids   uuid[] NOT NULL DEFAULT '{}',
  category              text,
  tags                  text[] NOT NULL DEFAULT '{}',
  source                text,
  author_membership_id  uuid NOT NULL,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'scheduled', 'published', 'archived', 'deleted')),
  audience              jsonb NOT NULL DEFAULT '{"public": true}'::jsonb,
  publish_at            timestamptz,
  expire_at             timestamptz,
  published_at          timestamptz,
  archived_at           timestamptz,
  deleted_at            timestamptz,
  unpublish_reason      text,
  notify_audience       boolean NOT NULL DEFAULT false,
  version               int NOT NULL DEFAULT 1,
  lock_version          int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, channel_id) REFERENCES news_channels (tenant_id, id),
  FOREIGN KEY (tenant_id, author_membership_id) REFERENCES memberships (tenant_id, id)
);
CREATE INDEX news_posts_feed_idx ON news_posts (tenant_id, status, published_at DESC);
CREATE INDEX news_posts_schedule_idx ON news_posts (publish_at) WHERE status = 'scheduled';
CREATE INDEX news_posts_expire_idx ON news_posts (expire_at) WHERE status = 'published' AND expire_at IS NOT NULL;
CREATE INDEX news_posts_search_idx ON news_posts USING gin (title gin_trgm_ops);

CREATE TABLE news_post_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  post_id     uuid NOT NULL,
  version     int NOT NULL,
  snapshot    jsonb NOT NULL,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, version),
  FOREIGN KEY (tenant_id, post_id) REFERENCES news_posts (tenant_id, id)
);

CREATE TABLE news_approvals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  post_id               uuid NOT NULL,
  version               int NOT NULL,
  approver_membership_id uuid NOT NULL,
  decision              text NOT NULL CHECK (decision IN ('approve', 'return')),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, post_id) REFERENCES news_posts (tenant_id, id)
);
CREATE UNIQUE INDEX news_approvals_once_idx ON news_approvals (post_id, version, approver_membership_id) WHERE decision = 'approve';

CREATE TABLE news_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  post_id        uuid NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid REFERENCES users (id),
  type           text NOT NULL,
  version        int NOT NULL,
  note           text,
  FOREIGN KEY (tenant_id, post_id) REFERENCES news_posts (tenant_id, id)
);
CREATE TRIGGER news_events_immutable BEFORE UPDATE OR DELETE ON news_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  title                   text NOT NULL,
  description_html        text NOT NULL DEFAULT '',
  category                text,
  organizer               text,
  organizer_unit_id       uuid,
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  location                text,
  online_url              text,
  cover_file_id           uuid,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'registration_open', 'registration_closed', 'held', 'cancelled')),
  visibility              text NOT NULL DEFAULT 'own_tenant' CHECK (visibility IN ('own_tenant', 'selected_tenants', 'public')),
  visible_tenant_ids      uuid[] NOT NULL DEFAULT '{}',
  registration_rule       jsonb NOT NULL DEFAULT '{"members": true}'::jsonb,
  capacity                int CHECK (capacity IS NULL OR capacity > 0),
  waitlist                boolean NOT NULL DEFAULT false,
  registration_deadline   timestamptz,
  requires_approval       boolean NOT NULL DEFAULT false,
  allow_cancel            boolean NOT NULL DEFAULT true,
  form                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- reserved for later phases (EVT-11): fee, certificates, conference papers
  fee_amount              bigint,
  certificate_enabled     boolean NOT NULL DEFAULT false,
  paper_track_id          uuid,
  news_post_id            uuid,
  created_by              uuid REFERENCES users (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, organizer_unit_id) REFERENCES org_units (tenant_id, id),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX events_list_idx ON events (tenant_id, status, starts_at);

CREATE TABLE event_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  event_id        uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users (id),
  home_tenant_id  uuid REFERENCES tenants (id),
  membership_id   uuid,
  status          text NOT NULL CHECK (status IN ('registered', 'pending', 'approved', 'rejected', 'cancelled', 'waitlisted')),
  answers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  code            text NOT NULL,
  attended_at     timestamptz,
  decided_at      timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code),
  FOREIGN KEY (tenant_id, event_id) REFERENCES events (tenant_id, id)
);
-- EVT-07: one active registration per person and event
CREATE UNIQUE INDEX event_registrations_once_idx ON event_registrations (event_id, user_id) WHERE status <> 'cancelled';
CREATE INDEX event_registrations_user_idx ON event_registrations (user_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['news_channels', 'news_channel_members', 'news_posts', 'news_post_versions', 'news_approvals', 'news_events', 'events', 'event_registrations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON news_channels, news_posts, events, event_registrations TO uni_app, uni_system;
GRANT SELECT, INSERT, DELETE ON news_channel_members TO uni_app, uni_system;
GRANT SELECT, INSERT ON news_post_versions, news_approvals, news_events TO uni_app, uni_system;
