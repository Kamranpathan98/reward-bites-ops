-- Stage 11 (Implementation Blueprint section 5): role/grant boundaries.
--
-- Repeatable (Flyway `R__`). Tenant-table grants are dynamic (driven off
-- the catalog); global-table grants below are explicit, `IF EXISTS`-guarded
-- lists, since those tables have no tenant_id for the dynamic loop to find.
--
-- Reminder for every future gate: Flyway only reapplies a repeatable when
-- its own checksum changes, not merely because new tables now exist for its
-- dynamic loop to pick up. Adding a tenant table in a later migration always
-- requires a trivial edit here (even just a comment) in the same change, or
-- the new table silently keeps app_migrator-only grants until something
-- happens to touch this file. Gate 4 (tables_qr_sessions) is the change that
-- prompted this note — restaurant_table/table_qr_token/table_session had no
-- app_rw/app_public grants at all until this comment forced a rerun.
--
-- Gate 5 (menu_catalog): menu_category/menu_item/menu_variant/menu_addon/
-- menu_item_addon pick up app_rw's standard grant from the dynamic loop
-- below via this comment as the forcing touch. None of the five get an
-- app_public grant — menu resolution for the public/unauthenticated QR
-- flow is explicitly Gate 11 scope, not Gate 5.
--
-- Gate 6 (orders_core): orders/order_line/order_line_addon pick up the
-- standard app_rw grant from the dynamic loop below (forced by this
-- comment). `order_status_history` needs no new logic here — it was
-- already special-cased in the append-only exception list below back in
-- Gate 2, anticipating this exact gate. None of the four get app_public
-- (Public Ordering is Gate 11, not Gate 6).

-- app_rw: SELECT/INSERT/UPDATE/DELETE on every tenant table (any table
-- with a tenant_id column), except the two append-only tables
-- (order_status_history, audit_event), which get SELECT/INSERT only —
-- their append-only-ness is enforced by withholding UPDATE/DELETE grants,
-- not by a trigger.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.relname AS table_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relkind = 'r'
      AND n.nspname = 'public'
  LOOP
    IF rec.table_name IN ('order_status_history', 'audit_event') THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO app_rw', rec.table_name);
      EXECUTE format('REVOKE UPDATE, DELETE ON public.%I FROM app_rw', rec.table_name);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_rw', rec.table_name);
    END IF;
  END LOOP;
END
$$;

-- app_rw also needs the global identity tables it touches directly
-- (login/refresh happen before a tenant is known, via withGlobalTx — see
-- apps/api/src/common/db/with-global-tx.ts). None of these carry
-- tenant_id, so RLS does not apply to them (architecture section 6/11);
-- the service layer, not the database, is the isolation boundary here —
-- e.g. every UPDATE on "user" is scoped `WHERE id = $ownUserId` by the
-- calling code, never a bare table-wide update.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user', 'refresh_token']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO app_rw', t);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'login_attempt') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.login_attempt TO app_rw';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'permission') THEN
    EXECUTE 'GRANT SELECT ON public.permission TO app_rw';
  END IF;

  -- `tenant` itself: read-only for app_rw in Gate 2 (GET /tenant only;
  -- no PATCH /tenant endpoint exists yet).
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant') THEN
    EXECUTE 'GRANT SELECT ON public.tenant TO app_rw';
  END IF;
END
$$;

-- app_public: exactly one grant across the whole schema — SELECT on
-- table_qr_token, for QR-token resolution only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'table_qr_token') THEN
    EXECUTE format('GRANT SELECT ON public.%I TO app_public', 'table_qr_token');
  END IF;
END
$$;

-- app_platform: tenant-provisioning tables only — never any
-- tenant-operational/financial table (orders, bill, payment, ...).
--
-- NOTE — discovered inconsistency, resolved here, reported to the user:
-- the architecture states app_platform's grants are "exactly tenant,
-- tenant_membership, user" (section 6.5 / blueprint stage 11), but also
-- describes `POST /platform/tenants` as creating "tenant + settings +
-- system roles + owner membership, one transaction" (section 12) — which
-- requires INSERT on tenant_settings, role, and role_permission too. Since
-- ids are server-generated UUID v7 by application code, not by Postgres
-- (architecture section 11: "the browser never mints entity ids" — the
-- same principle extends to triggers, which is the only other place these
-- rows could originate), there is no way to satisfy the one-transaction
-- provisioning description while holding app_platform to literally three
-- tables without hand-rolling UUID v7 generation in PL/pgSQL. This grants
-- app_platform the tenant-shell tables its provisioning transaction
-- actually writes; the security-critical half of the original invariant —
-- app_platform can never touch tenant-operational data — is preserved
-- exactly.
--
-- audit_event added here after live DB verification: PlatformService
-- .provisionTenant() also writes an audit_event row in the same
-- transaction (recordAuditEvent), which this list omitted — every
-- provisioning call was failing with "permission denied for table
-- audit_event" until this grant existed. SELECT + INSERT only, matching
-- the append-only exception already used for app_rw elsewhere in this
-- file: platform never updates or deletes audit history.
DO $$
DECLARE
  platform_table text;
BEGIN
  FOREACH platform_table IN ARRAY ARRAY[
    'tenant', 'tenant_settings', 'role', 'role_permission', 'tenant_membership', 'user'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = platform_table) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO app_platform', platform_table);
    END IF;
  END LOOP;

  -- role_permission additionally needs SELECT-only visibility into the
  -- global permission catalog to validate keys before inserting mappings.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'permission') THEN
    EXECUTE 'GRANT SELECT ON public.permission TO app_platform';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_event') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.audit_event TO app_platform';
  END IF;
END
$$;

-- Onboarding (docs/IMPLEMENTATION_STATUS.md "Onboarding" section):
-- POST /auth/signup's abuse counter lives in public_rate_limit, checked and
-- incremented through the same app_platform pool the signup provisioning
-- transaction already uses. No tenant_id, so no RLS applies (see the
-- table's own migration comment) — a plain grant is the whole story.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'public_rate_limit') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.public_rate_limit TO app_platform';
  END IF;
END
$$;
