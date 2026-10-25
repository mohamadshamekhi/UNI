-- Phase 2: deadlines and SLA (WF-20..24).

-- Holiday calendar: tenant_id NULL = official national holidays (managed by the platform),
-- otherwise the university's own closures. Weekend days come from tenant settings.
CREATE TABLE calendar_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants (id),
  day         date NOT NULL,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users (id)
);
CREATE UNIQUE INDEX calendar_holidays_tenant_day ON calendar_holidays (tenant_id, day) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX calendar_holidays_national_day ON calendar_holidays (day) WHERE tenant_id IS NULL;

ALTER TABLE calendar_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_holidays FORCE ROW LEVEL SECURITY;
-- everyone reads the national list; tenants write only their own rows
CREATE POLICY holidays_read ON calendar_holidays FOR SELECT USING (tenant_id IS NULL OR tenant_id = app_tenant_id());
CREATE POLICY holidays_write ON calendar_holidays FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY holidays_delete ON calendar_holidays FOR DELETE USING (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, DELETE ON calendar_holidays TO uni_app;
GRANT SELECT, INSERT, DELETE ON calendar_holidays TO uni_system;

-- Durable deadline schedule per task (WF-24): the sweep picks rows whose sla_next_at has passed,
-- so nothing is lost across restarts. sla_schedule = [{ at, kind: before|due|after, done }]
ALTER TABLE case_tasks
  ADD COLUMN sla_schedule  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN sla_next_at   timestamptz,
  ADD COLUMN overdue_at    timestamptz,
  ADD COLUMN escalated_at  timestamptz,
  ADD COLUMN auto_extended boolean NOT NULL DEFAULT false;
CREATE INDEX case_tasks_sla_next_idx ON case_tasks (sla_next_at) WHERE status = 'open' AND sla_next_at IS NOT NULL;
