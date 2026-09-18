-- scripts/db-init.sql
--
-- One-time bootstrap for a fresh RewardBite database. Creates the four
-- PostgreSQL roles everything else depends on, and hands schema ownership
-- to the migration role. Run ONCE, by a superuser, against an already
-- existing (empty) database — BEFORE Flyway ever connects, since Flyway
-- itself connects as `app_migrator`, which must already exist.
--
-- Roles (Implementation Blueprint section 5 / 21, architecture section 6):
--   app_migrator — owns the schema, runs all DDL. Flyway connects as this role.
--   app_rw       — the API's runtime role. NOBYPASSRLS — this is enforced by
--                  a startup check in apps/api that refuses to boot otherwise.
--   app_public   — QR-token lookup only (one grant, added in R__grants). NOBYPASSRLS.
--   app_platform — platform routes only (three tables, added in R__grants). NOBYPASSRLS.
--
-- No business tables are created here or by any Sprint 1 migration.
--
-- Usage:
--   psql -U postgres -d rewardbite \
--     -v app_migrator_password=some_strong_password \
--     -v app_rw_password=some_strong_password \
--     -v app_public_password=some_strong_password \
--     -v app_platform_password=some_strong_password \
--     -f scripts/db-init.sql
--
-- Any password not supplied via -v falls back to a `change_me_*` local-dev
-- placeholder — never use the defaults outside a throwaway local database.
--
-- Implementation note: every conditional CREATE ROLE below is a plain,
-- top-level statement guarded by `\if` on a `\gset` existence check —
-- deliberately NOT a `DO $$ ... $$` block with dynamic EXECUTE. psql's
-- client-side `:'var'` substitution does not run inside dollar-quoted
-- text (this is intentional upstream behaviour, so a PL/pgSQL function
-- body's own literal `:` usage is never mangled) — a `:'app_migrator_password'`
-- reference placed inside `$$ ... $$` is sent to the server completely
-- unsubstituted and fails with a syntax error. Keeping the substitution at
-- the top level, outside any dollar-quoting, is what actually works.

\set ON_ERROR_STOP on

\if :{?app_migrator_password}
\else
  \set app_migrator_password change_me_migrator
\endif
\if :{?app_rw_password}
\else
  \set app_rw_password change_me_rw
\endif
\if :{?app_public_password}
\else
  \set app_public_password change_me_public
\endif
\if :{?app_platform_password}
\else
  \set app_platform_password change_me_platform
\endif

-- app_migrator: owns the schema, the only role that runs DDL. CREATEROLE
-- is required so the V..._db_roles Flyway migration (run as app_migrator)
-- can idempotently (re-)assert the other three roles from inside Flyway.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') AS exists \gset migrator_
\if :migrator_exists
\else
  CREATE ROLE app_migrator LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOBYPASSRLS PASSWORD :'app_migrator_password';
\endif

-- app_rw: the API runtime role. Must never bypass RLS.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') AS exists \gset rw_
\if :rw_exists
  ALTER ROLE app_rw NOBYPASSRLS;
\else
  CREATE ROLE app_rw LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_rw_password';
\endif

-- app_public: QR-token lookup only. Must never bypass RLS.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_public') AS exists \gset public_
\if :public_exists
  ALTER ROLE app_public NOBYPASSRLS;
\else
  CREATE ROLE app_public LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_public_password';
\endif

-- app_platform: platform routes only (tenant, tenant_membership, user). Must never bypass RLS.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') AS exists \gset platform_
\if :platform_exists
  ALTER ROLE app_platform NOBYPASSRLS;
\else
  CREATE ROLE app_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_platform_password';
\endif

-- app_migrator owns the public schema so Flyway can freely create/alter
-- objects in it. The three runtime roles only get USAGE here; their actual
-- SELECT/INSERT/UPDATE/DELETE grants are added once tables exist, by
-- db/migrations/R__grants.sql (stage 11 of the migration dependency plan).
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_rw, app_public, app_platform;

-- Since PostgreSQL 16, holding CREATEROLE is no longer sufficient to
-- ALTER a role you didn't create — the altering role must also hold
-- ADMIN OPTION on the target (discovered by actually running this: the
-- V..._db_roles Flyway migration's defensive `ALTER ROLE app_rw
-- NOBYPASSRLS` re-assertion fails with "permission denied to alter role"
-- otherwise, since these three roles were created here by the bootstrap
-- superuser, not by app_migrator itself). Harmless beyond that: app_migrator
-- already owns the whole schema, a strict superset of anything these
-- roles are ever granted, so inheriting their membership adds no privilege
-- it doesn't already effectively have.
GRANT app_rw TO app_migrator WITH ADMIN OPTION;
GRANT app_public TO app_migrator WITH ADMIN OPTION;
GRANT app_platform TO app_migrator WITH ADMIN OPTION;

-- Schema ownership alone is not enough for CREATE EXTENSION: even a
-- "trusted" extension (pg_trgm, stage 0's V..._extensions migration) can
-- only be installed by a role holding CREATE on the *database*, not just
-- the schema — discovered by actually running this against a real
-- Postgres instance, where app_migrator otherwise fails with "permission
-- denied to create extension" despite owning public.
SELECT current_database() AS dbname \gset
GRANT CREATE ON DATABASE :dbname TO app_migrator;

-- Sanity output, not a substitute for the automated startup check in
-- apps/api (common/db/assert-no-bypass-rls.ts) or scripts/rls-coverage-check.mjs.
SELECT rolname, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('app_migrator', 'app_rw', 'app_public', 'app_platform')
ORDER BY rolname;
