-- Gate 8: Billing settings defaults and constraints
-- Canonical V1: round_to_rupee = true
ALTER TABLE tenant_settings
  ALTER COLUMN round_to_rupee SET DEFAULT true;

-- tenant_settings has FORCE ROW LEVEL SECURITY and app_migrator is NOBYPASSRLS, so
-- without app.tenant_id set every UPDATE below would silently match zero rows (the
-- fresh-database path never notices; an upgrade would). Lift FORCE for the rest of
-- this migration's transaction only and restore it before it commits.
-- (R__rls_policies.sql re-asserts FORCE on every run as well.)
ALTER TABLE tenant_settings NO FORCE ROW LEVEL SECURITY;

-- Safe backfill: ensure existing tenants have round_to_rupee = true
UPDATE tenant_settings
   SET round_to_rupee = true
 WHERE round_to_rupee IS FALSE;

-- Constraint: max_discount_bp must be between 0 and 10000 (0% to 100%). Nothing
-- could set an out-of-range value through the application before Gate 8, but the
-- column had no CHECK, so clamp any such row first rather than fail the upgrade.
UPDATE tenant_settings
   SET max_discount_bp = LEAST(GREATEST(max_discount_bp, 0), 10000)
 WHERE max_discount_bp NOT BETWEEN 0 AND 10000;

ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_max_discount_bp_range
  CHECK (max_discount_bp BETWEEN 0 AND 10000);
