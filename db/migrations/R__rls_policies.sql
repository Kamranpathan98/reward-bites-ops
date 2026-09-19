-- Stage 10 (Implementation Blueprint section 5): enable + FORCE RLS on
-- every table with a `tenant_id` column, with one USING and one WITH CHECK
-- policy each (architecture section 6, point 4).
--
-- Repeatable (Flyway `R__`): re-applied on every migrate whenever this
-- file's checksum changes. Dynamic and driven entirely off the catalog, so
-- it needs no edits as new tenant tables are introduced in later gates —
-- except that Flyway only reapplies on a checksum change (see the note in
-- R__grants.sql), so a trivial touch here is still required each gate; this
-- comment is Gate 5's (menu_category/menu_item/menu_variant/menu_addon/
-- menu_item_addon all pick up the plain generic policy below — none of them
-- need a bespoke one, unlike table_qr_token in Gate 4, since nothing reads
-- them before a tenant context exists in this gate's scope). Gate 6
-- (orders/order_line/order_line_addon/order_status_history) is the same
-- story — all four get the plain generic policy, no bespoke exception;
-- Public Ordering (the one thing that would need pre-tenant-context reads)
-- is Gate 11.
-- As of Gate 2 this covers tenant_settings, role, role_permission,
-- tenant_counter (tenant_membership is special-cased below). Global
-- identity tables (user, refresh_token, login_attempt, platform_admin,
-- permission) have no tenant_id and are deliberately not looped over here
-- — see architecture section 6 ("every table with a tenant_id column") and
-- section 11's table catalog, which gives no RLS note for those tables.
--
-- `current_setting(name, true)` returns NULL when unset; casting an empty
-- string to ::uuid raises an error rather than comparing false, so every
-- policy below goes through `NULLIF(..., '')` first to turn "unset" into a
-- clean NULL — which then makes the whole comparison NULL (i.e. no match,
-- fail-closed), never a thrown error.

-- Gate 8 (billing_core, payments): bill, bill_order, bill_line,
-- bill_adjustment and payment all pick up the plain generic policy below
-- (tenant_id = app.tenant_id, USING + WITH CHECK, forced) — none needs a
-- bespoke policy. This comment is also the checksum-bump touch Flyway needs
-- to re-run the dynamic loop for the new tables.
-- bespoke policy.
--
-- Gate 10 (expenses): expense_category and expense pick up the plain generic
-- policy below (forced RLS, tenant_id = app.tenant_id, USING + WITH CHECK).
-- This comment is the checksum-bump touch Flyway needs to re-run the dynamic
-- loop for the new tables.
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
      AND c.relname NOT IN ('tenant_membership', 'table_qr_token')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rec.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', rec.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I '
        || 'USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
        || 'WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      rec.table_name
    );
  END LOOP;
END
$$;

-- `tenant` itself has no tenant_id column (it IS the tenant), so the
-- generic loop above never touches it. Architecture section 11: "no
-- tenant_id; RLS: platform role or own id" — a platform actor sees every
-- tenant (needed to create/suspend tenants); a tenant-bound actor sees
-- only the one row matching its own resolved tenant id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant') THEN
    EXECUTE 'ALTER TABLE public.tenant ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenant FORCE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS platform_or_own_tenant ON public.tenant';
    EXECUTE $policy$
      CREATE POLICY platform_or_own_tenant ON public.tenant
        USING (
          current_setting('app.actor_kind', true) = 'platform'
          OR id = nullif(current_setting('app.tenant_id', true), '')::uuid
        )
        WITH CHECK (
          current_setting('app.actor_kind', true) = 'platform'
          OR id = nullif(current_setting('app.tenant_id', true), '')::uuid
        )
    $policy$;
  END IF;
END
$$;

-- `tenant_membership` is the one table that structurally needs a wider
-- USING clause than plain tenant-id isolation: `POST /auth/login`
-- discovers a user's memberships ACROSS every tenant they belong to,
-- before any single tenant context exists (see
-- apps/api/src/modules/identity/membership.repository.ts,
-- findActiveByUserId). No single `app.tenant_id` setting could ever
-- satisfy a query that must legitimately span tenants for one user.
--
-- USING therefore accepts either the normal tenant-scoped read (matches
-- the generic policy above) OR a read of the caller's OWN membership rows
-- by `app.user_id`, which withGlobalTx always sets even with no tenant
-- context. This can never leak another user's memberships: the OR clause
-- is keyed on `app.user_id`, which the server sets from the verified JWT
-- `sub` claim, never from client input.
--
-- WITH CHECK stays tenant-id-only (no user_id escape hatch) — every write
-- to this table happens inside a real `withTenantTx` (invite, role/status
-- change), so nothing should ever need to write cross-tenant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant_membership') THEN
    EXECUTE 'ALTER TABLE public.tenant_membership ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenant_membership FORCE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_or_own_membership ON public.tenant_membership';
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_or_own_membership ON public.tenant_membership
        USING (
          tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
          OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
        )
        WITH CHECK (
          tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        )
    $policy$;
  END IF;
END
$$;

-- `table_qr_token` is the one table `app_public` reads, and it reads it
-- BEFORE any tenant context exists — token resolution is what discovers the
-- tenant in the first place (PublicQrGuard, architecture ADR-023). No
-- `app.tenant_id` setting could ever be in place for that lookup, so the
-- generic tenant-scoped policy above would always deny it.
--
-- USING therefore accepts either the normal tenant-scoped read (the staff
-- tables/QR screens, running as app_rw with a real tenant context) OR any
-- row when the connected role is literally `app_public`. That second branch
-- is safe specifically because `app_public` holds exactly one grant in the
-- whole database — SELECT on this table only (R__grants.sql, architecture
-- section 6) — so relaxing which ROWS it can see changes nothing about what
-- OPERATIONS it can perform; the grant, not this policy, is the boundary
-- that keeps it out of every other table. `current_user` reflects the actual
-- authenticated database role (the pool connects with its own dedicated
-- credential; nothing in this codebase ever runs `SET ROLE`), unlike
-- `current_setting('app.*')`, which is only as trustworthy as the
-- application code that sets it — so this is a strictly stronger check than
-- the tenant/tenant_membership policies above, not a weaker one.
--
-- WITH CHECK stays tenant-id-only: `app_public` never writes here at all
-- (its grant is SELECT-only), and every real write (issue/regenerate/revoke)
-- happens as app_rw inside a real `withTenantTx`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'table_qr_token') THEN
    EXECUTE 'ALTER TABLE public.table_qr_token ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.table_qr_token FORCE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_or_public_lookup ON public.table_qr_token';
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_or_public_lookup ON public.table_qr_token
        USING (
          tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
          OR current_user = 'app_public'
        )
        WITH CHECK (
          tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        )
    $policy$;
  END IF;
END
$$;
