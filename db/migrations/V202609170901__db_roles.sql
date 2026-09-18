-- Stage 0 (Implementation Blueprint section 5): "Create app_migrator
-- (implicit as migration runner), app_rw, app_public, app_platform roles,
-- NOBYPASSRLS on all three | roles only, no grants yet (grants come after
-- tables exist, stage 12)."
--
-- app_migrator itself must already exist for Flyway to have connected at
-- all — it is created (once, by a superuser) in scripts/db-init.sql, which
-- also normally creates the other three roles. This migration creates a
-- role with a placeholder password only if scripts/db-init.sql was never
-- run for it; it never issues DML/DDL against business tables — none
-- exist yet.
--
-- What this migration deliberately does NOT do: `ALTER ROLE ...
-- NOBYPASSRLS` to defensively re-assert the invariant when a role already
-- exists. Discovered by actually running this against a real Postgres
-- instance: since PostgreSQL 16, only a role that ITSELF already has
-- BYPASSRLS may change any role's BYPASSRLS attribute — including
-- re-asserting an already-correct value. app_migrator is deliberately
-- NOBYPASSRLS (blueprint stage 0's own requirement), so it can never
-- satisfy that check; attempting the ALTER unconditionally breaks the
-- migration with "permission denied to alter role" the moment the roles
-- already exist, i.e. on every run after the first. The invariant is
-- still enforced — just by roles that can actually read (not write) it:
-- apps/api's own startup check (common/db/assert-no-bypass-rls.ts) and
-- scripts/rls-coverage-check.mjs (CI), both plain SELECTs against
-- pg_roles, which need no special privilege.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    RAISE NOTICE 'app_rw did not exist — creating with a placeholder password; reset it before any real use.';
    -- NOBYPASSRLS omitted, not stated explicitly: it's the default for a
    -- newly created role, and app_migrator (NOBYPASSRLS itself) cannot
    -- grant an attribute value it doesn't hold, even a no-op one, per the
    -- same PG16 restriction noted above.
    CREATE ROLE app_rw LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'change_me_rw';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_public') THEN
    RAISE NOTICE 'app_public did not exist — creating with a placeholder password; reset it before any real use.';
    CREATE ROLE app_public LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'change_me_public';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    RAISE NOTICE 'app_platform did not exist — creating with a placeholder password; reset it before any real use.';
    CREATE ROLE app_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'change_me_platform';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_rw, app_public, app_platform;
