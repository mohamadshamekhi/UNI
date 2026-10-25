-- Phase 2: notification service (section 13, NTF-01..14). Defaults (events, rules, templates)
-- live in code; tenants store only their overrides.

CREATE TABLE notification_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  event       text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('inapp', 'sms', 'email')),
  locale      text NOT NULL DEFAULT 'fa',
  subject     text,
  body        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users (id),
  UNIQUE (tenant_id, event, channel, locale)
);

CREATE TABLE notification_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  event       text NOT NULL,
  recipient   text NOT NULL,
  channels    text[] NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users (id),
  UNIQUE (tenant_id, event, recipient)
);

-- one row per event × recipient × channel (NTF-05/06); the worker sends queued rows
CREATE TABLE notification_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenants (id),
  event                text NOT NULL,
  user_id              uuid NOT NULL REFERENCES users (id),
  channel              text NOT NULL CHECK (channel IN ('inapp', 'sms', 'email')),
  critical             boolean NOT NULL DEFAULT false,
  idempotency_key      text NOT NULL UNIQUE,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'dead', 'skipped')),
  subject              text,
  body                 text NOT NULL,
  attempts             int NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  provider_message_id  text,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz
);
CREATE INDEX notification_deliveries_queue_idx ON notification_deliveries (next_attempt_at) WHERE status = 'queued';
CREATE INDEX notification_deliveries_tenant_idx ON notification_deliveries (tenant_id, created_at DESC);

-- in-app inbox (NTF-09)
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  event       text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  link        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (tenant_id, user_id) WHERE read_at IS NULL;

-- channels a user turned off for non-critical notifications (NTF-10)
CREATE TABLE notification_mutes (
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  channel     text NOT NULL CHECK (channel IN ('inapp', 'sms', 'email')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, channel)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_templates', 'notification_rules', 'notification_deliveries', 'notifications', 'notification_mutes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_templates, notification_rules, notification_mutes TO uni_app, uni_system;
GRANT SELECT, INSERT, UPDATE ON notification_deliveries, notifications TO uni_app, uni_system;
