-- Pulled forward from stage 9 (audit_and_support) of the blueprint's
-- migration dependency plan. Its only listed dependency is tenant_core,
-- which this gate already introduces, and Gate 2's own task brief requires
-- real, transactional audit behavior for every mutation it implements
-- (invite, role/status change, login, password change, tenant
-- provisioning). `public_rate_limit` and `image_asset` — the other two
-- tables at stage 9 — are NOT created here: they belong to the public-QR
-- and storage gates and have no Gate 2 caller.
--
-- `audit_event` carries tenant_id and is picked up automatically by the
-- dynamic R__rls_policies.sql / R__grants.sql (already special-cased there
-- as append-only: SELECT/INSERT only, no UPDATE/DELETE grant for app_rw).

CREATE TABLE audit_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'customer', 'system', 'platform')),
  actor_id UUID,
  before JSONB,
  after JSONB,
  request_id TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_tenant_entity_idx ON audit_event (tenant_id, entity_type, entity_id);
CREATE INDEX audit_event_tenant_at_idx ON audit_event (tenant_id, at);
