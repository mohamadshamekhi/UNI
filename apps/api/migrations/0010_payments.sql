-- Phase 6: payment module (section 12, PAY-01..13). Amounts are whole rials (bigint).

CREATE TABLE fee_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  service_key     text NOT NULL CHECK (service_key ~ '^[a-z0-9_.:-]{2,80}$'),
  title           text NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_key, version)
);
CREATE INDEX fee_schedules_lookup_idx ON fee_schedules (tenant_id, service_key, effective_from DESC);

-- one active adapter per tenant; the merchant secret is encrypted with SECRETS_KEY (PAY-03)
CREATE TABLE gateway_configs (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants (id),
  adapter           text NOT NULL,
  merchant_id       text,
  secret_encrypted  text,
  active            boolean NOT NULL DEFAULT true,
  updated_by        uuid REFERENCES users (id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  tracking_code        text NOT NULL,
  service_key          text NOT NULL,
  fee_schedule_id      uuid REFERENCES fee_schedules (id),
  title                text NOT NULL,
  amount               bigint NOT NULL CHECK (amount > 0),
  payer_user_id        uuid NOT NULL REFERENCES users (id),
  payer_membership_id  uuid,
  ref_type             text NOT NULL CHECK (ref_type IN ('case', 'event_registration', 'manual')),
  ref_id               uuid,
  ref_step_id          text,
  status               text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'review', 'refunded')),
  idempotency_key      text NOT NULL,
  expires_at           timestamptz,
  paid_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  lock_version         integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, tracking_code),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX payment_requests_payer_idx ON payment_requests (payer_user_id, created_at DESC);
CREATE INDEX payment_requests_report_idx ON payment_requests (tenant_id, status, created_at);
CREATE INDEX payment_requests_ref_idx ON payment_requests (ref_type, ref_id);

-- every attempt at the bank; never card numbers, CVV2 or PINs (PAY-04)
CREATE TABLE payment_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  request_id      uuid NOT NULL,
  adapter         text NOT NULL,
  amount          bigint NOT NULL,
  authority       text,
  reference_id    text,
  status          text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'succeeded', 'failed', 'unknown', 'cancelled')),
  error_code      text,
  error_message   text,
  verify_payload  jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  checked_at      timestamptz,
  UNIQUE (adapter, authority),
  FOREIGN KEY (tenant_id, request_id) REFERENCES payment_requests (tenant_id, id)
);
CREATE INDEX payment_transactions_request_idx ON payment_transactions (request_id, started_at DESC);
CREATE INDEX payment_transactions_pending_idx ON payment_transactions (status, started_at) WHERE status IN ('started', 'unknown');

CREATE TABLE payment_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  request_id      uuid NOT NULL UNIQUE,
  transaction_id  uuid NOT NULL REFERENCES payment_transactions (id),
  receipt_no      text NOT NULL,
  amount          bigint NOT NULL,
  reference_id    text,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_no),
  FOREIGN KEY (tenant_id, request_id) REFERENCES payment_requests (tenant_id, id)
);

CREATE TABLE payment_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  request_id   uuid NOT NULL,
  type         text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES users (id),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, request_id) REFERENCES payment_requests (tenant_id, id)
);
CREATE INDEX payment_events_request_idx ON payment_events (request_id, occurred_at);
CREATE TRIGGER payment_events_immutable BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- anonymous view counter for news reports (no viewer identity)
CREATE TABLE news_post_views (
  tenant_id  uuid NOT NULL,
  post_id    uuid NOT NULL,
  day        date NOT NULL,
  views      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, day)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_schedules', 'gateway_configs', 'payment_requests', 'payment_transactions', 'payment_receipts', 'payment_events', 'news_post_views'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON fee_schedules, payment_receipts, payment_events TO uni_app, uni_system;
GRANT SELECT, INSERT, UPDATE ON gateway_configs, payment_requests, payment_transactions, news_post_views TO uni_app, uni_system;
GRANT USAGE ON SEQUENCE payment_events_id_seq TO uni_app, uni_system;

-- tracking codes `PAY-<persian year>-<seq>` and receipt numbers
CREATE SEQUENCE payment_tracking_seq;
GRANT USAGE ON SEQUENCE payment_tracking_seq TO uni_app, uni_system;
