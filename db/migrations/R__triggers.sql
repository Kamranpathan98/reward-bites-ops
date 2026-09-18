-- Stage 12 (Implementation Blueprint section 5): "updated_at generic
-- trigger on every table that has the column." First repeatable of this
-- kind — Gate 2 is the first gate with tables carrying `updated_at`
-- (user, tenant, tenant_settings, role, tenant_membership, platform_admin).
-- The other triggers this stage eventually owns (order_line_addon ->
-- line_total, bill immutability, payment settlement) belong to the gates
-- that introduce those tables and are not created here.
--
-- Repeatable (Flyway `R__`), dynamic and catalog-driven like
-- R__rls_policies.sql / R__grants.sql — no edits needed as later gates add
-- more `updated_at` columns, EXCEPT that Flyway only reapplies a repeatable
-- when its own checksum changes (see the note in R__grants.sql). A gate that
-- adds a new `updated_at` column still needs a trivial touch here, same as
-- grants. Gate 4 (restaurant_table, table_session) is the change that
-- prompted this note. Gate 5 (menu_category, menu_item, menu_variant,
-- menu_addon — menu_item_addon has no updated_at, matching role_permission's
-- junction-table pattern) is this comment's forcing touch. Gate 6 (orders,
-- order_line) also touches this file — see the two new aggregate-recompute
-- triggers below, which this stage's own original comment anticipated
-- ("order_line_addon -> line_total, ... order_line -> order.subtotal_paise").

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $trigger$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.relname AS table_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attname = 'updated_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relkind = 'r'
      AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', rec.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      rec.table_name
    );
  END LOOP;
END
$$;

-- Gate 6: `order_line.line_total_paise` and `orders.subtotal_paise` /
-- `line_count` are database-owned aggregates (architecture section 8;
-- task instruction section 13 — a same-row CHECK cannot see child rows).
-- Two triggers, chained:
--
--   1. order_line BEFORE INSERT OR UPDATE: recomputes NEW.line_total_paise
--      from the row's own unit_price_paise*qty plus a fresh subquery over
--      its order_line_addon children. Fires on every direct edit to a line
--      (e.g. a qty change from PATCH /orders/:id/lines).
--   2. order_line_addon AFTER INSERT OR UPDATE OR DELETE: the addon rows
--      themselves don't own line_total_paise, so this trigger does a plain
--      "touch" UPDATE on the parent order_line row (only bumping
--      updated_at) purely to re-fire trigger 1 above, which then
--      recomputes line_total_paise from a fresh subquery reflecting the
--      addon change that just happened. No formula is duplicated between
--      the two triggers.
--
-- A third trigger (order_line AFTER INSERT OR UPDATE OR DELETE) recomputes
-- the parent `orders.subtotal_paise` / `line_count` the same way, summing
-- only ACTIVE lines — this fires both on direct order_line edits and as a
-- side effect of trigger 2's touch-update, so an addon change correctly
-- cascades all the way up to the order's own subtotal in one transaction.
CREATE OR REPLACE FUNCTION recompute_order_line_total() RETURNS trigger AS $trigger$
BEGIN
  NEW.line_total_paise := NEW.unit_price_paise * NEW.qty + COALESCE(
    (SELECT SUM(ola.unit_price_paise * ola.qty)
       FROM order_line_addon ola
      WHERE ola.tenant_id = NEW.tenant_id AND ola.order_line_id = NEW.id),
    0
  );
  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_order_line_on_addon_change() RETURNS trigger AS $trigger$
BEGIN
  UPDATE order_line
     SET updated_at = now()
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND id = COALESCE(NEW.order_line_id, OLD.order_line_id);
  RETURN NULL;
END;
$trigger$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recompute_order_subtotal() RETURNS trigger AS $trigger$
DECLARE
  v_tenant_id UUID := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_order_id UUID := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE orders o
     SET subtotal_paise = COALESCE(
           (SELECT SUM(ol.line_total_paise) FROM order_line ol
             WHERE ol.tenant_id = v_tenant_id AND ol.order_id = v_order_id AND ol.status = 'ACTIVE'),
           0
         ),
         line_count = (
           SELECT count(*) FROM order_line ol
            WHERE ol.tenant_id = v_tenant_id AND ol.order_id = v_order_id AND ol.status = 'ACTIVE'
         )
   WHERE o.tenant_id = v_tenant_id AND o.id = v_order_id;
  RETURN NULL;
END;
$trigger$ LANGUAGE plpgsql;

-- Trigger *attachment* (unlike the function definitions above) needs the
-- target tables to exist, so — matching this file's established defensive
-- style for other hardcoded, non-dynamic blocks (tenant, tenant_membership,
-- table_qr_token in R__rls_policies.sql) — each is guarded.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_line') THEN
    DROP TRIGGER IF EXISTS recompute_order_line_total ON order_line;
    CREATE TRIGGER recompute_order_line_total
      BEFORE INSERT OR UPDATE ON order_line
      FOR EACH ROW EXECUTE FUNCTION recompute_order_line_total();

    DROP TRIGGER IF EXISTS recompute_order_subtotal ON order_line;
    CREATE TRIGGER recompute_order_subtotal
      AFTER INSERT OR UPDATE OR DELETE ON order_line
      FOR EACH ROW EXECUTE FUNCTION recompute_order_subtotal();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_line_addon') THEN
    DROP TRIGGER IF EXISTS touch_order_line_on_addon_change ON order_line_addon;
    CREATE TRIGGER touch_order_line_on_addon_change
      AFTER INSERT OR UPDATE OR DELETE ON order_line_addon
      FOR EACH ROW EXECUTE FUNCTION touch_order_line_on_addon_change();
  END IF;
END
$$;
