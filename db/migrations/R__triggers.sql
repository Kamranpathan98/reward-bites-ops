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

-- ============================================================================
-- Gate 8: billing, payments and billed-order protection
-- ============================================================================
--
-- Database-owned financial invariants (architecture ADR-013 / ADR-024,
-- section 9 and section 20). Every guard below is a BEFORE row trigger that
-- compares SPECIFIC columns (never a whole-row comparison), so it is
-- insensitive to trigger ordering against set_updated_at (row triggers of the
-- same timing fire alphabetically by name; every guard here is named so it
-- fires before `set_updated_at`, and none of them looks at updated_at anyway).
--
-- Custom SQLSTATEs (class 'RB', mapped to domain errors by the API's
-- pg-errors helper; they should never reach a client — services validate
-- first — they are the last line of defence against a service bug):
--   RB001 billed order's line/add-on mutated       RB002 orders.table_session_id changed
--   RB003 billed order subtotal changed            RB004 billed order line_count changed
--   RB005 order re-linked X -> Y                   RB006 order unlinked from a non-FINALIZED bill
--   RB007 billed order cancelled                   RB008 billed COMPLETED order reopened
--   RB009 cancelled order linked to a bill         RB010 order linked to a non-DRAFT bill
--   RB011 order inserted with a bill_id
--   RB020 payment on a non-FINALIZED bill          RB021 overpayment
--   RB030 bill field not mutable in this state     RB031 direct write of settlement fields
--   RB032 PAID set outside the settlement trigger  RB033 void with money paid
--   RB034 void while orders still link to the bill RB035 illegal bill status transition
--   RB036 terminal bill mutated                    RB038 DRAFT -> FINALIZED edge check failed
--   RB039 bill inserted in a non-draft shape
--   RB040 bill child row changed on a non-DRAFT bill
--   RB041 order and bill are in different table sessions
--   RB042 adjustment kind not supported in V1

-- 1. bill: state machine + snapshot immutability + settlement ownership.
--
-- Settlement fields (paid_paise, outstanding_paise, the FINALIZED -> PAID
-- edge) may only be written by the payment settlement trigger. That is
-- decided by pg_trigger_depth(): a statement issued directly by a service runs
-- this trigger at depth 1; the settlement trigger's UPDATE runs it at depth 2.
-- Unlike a session flag (set_config) or SECURITY DEFINER, a client statement
-- cannot forge trigger nesting.
CREATE OR REPLACE FUNCTION bill_guard() RETURNS trigger AS $trigger$
DECLARE
  v_changed text[];
  v_depth int := pg_trigger_depth();
  v_line_sum NUMERIC;
  v_line_count BIGINT;
  v_discount_sum NUMERIC;
  v_members BIGINT;
  v_unlinked BIGINT;
  v_still_linked BIGINT;
  c_draft_cols CONSTANT text[] := ARRAY[
    'subtotal_paise', 'discount_paise', 'rounding_paise', 'grand_total_paise',
    'outstanding_paise', 'customer_name', 'notes', 'version'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.paid_paise <> 0 OR NEW.bill_number IS NOT NULL
       OR NEW.finalized_at IS NOT NULL OR NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'A bill must be inserted as a clean DRAFT' USING ERRCODE = 'RB039';
    END IF;
    RETURN NEW;
  END IF;

  -- Columns that changed, excluding the housekeeping updated_at.
  SELECT COALESCE(array_agg(n.key), '{}') INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value AND n.key <> 'updated_at';

  IF v_changed && ARRAY['id', 'tenant_id', 'table_session_id', 'created_by', 'created_at',
                        'idempotency_key', 'idempotency_fingerprint'] THEN
    RAISE EXCEPTION 'Identity columns of bill % are immutable', OLD.id USING ERRCODE = 'RB030';
  END IF;

  -- PAID / VOID / DISCARDED are terminal: nothing changes.
  IF OLD.status IN ('PAID', 'VOID', 'DISCARDED') THEN
    IF cardinality(v_changed) > 0 THEN
      RAISE EXCEPTION 'Bill % is % and immutable', OLD.id, OLD.status USING ERRCODE = 'RB036';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' THEN
    IF NEW.status = 'DRAFT' THEN
      IF NOT (v_changed <@ c_draft_cols) THEN
        RAISE EXCEPTION 'Column(s) % of DRAFT bill % cannot be changed', v_changed, OLD.id
          USING ERRCODE = 'RB030';
      END IF;

    ELSIF NEW.status = 'DISCARDED' THEN
      IF NOT (v_changed <@ ARRAY['status', 'version']) THEN
        RAISE EXCEPTION 'Discarding bill % may only change status/version', OLD.id
          USING ERRCODE = 'RB030';
      END IF;

    ELSIF NEW.status = 'FINALIZED' THEN
      IF NOT (v_changed <@ (c_draft_cols || ARRAY['status', 'bill_number', 'finalized_at', 'finalized_by'])) THEN
        RAISE EXCEPTION 'Finalizing bill % changed unexpected columns %', OLD.id, v_changed
          USING ERRCODE = 'RB030';
      END IF;

      -- Edge checks: the snapshot being frozen must be internally consistent.
      SELECT COALESCE(SUM(line_total_paise), 0), count(*) INTO v_line_sum, v_line_count
        FROM bill_line WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.id;
      SELECT COALESCE(SUM(amount_paise), 0) INTO v_discount_sum
        FROM bill_adjustment
       WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.id
         AND kind IN ('DISCOUNT_PERCENT', 'DISCOUNT_FIXED');
      IF v_line_count = 0 OR v_line_sum <> NEW.subtotal_paise OR v_discount_sum <> NEW.discount_paise THEN
        RAISE EXCEPTION 'Bill % snapshot inconsistent at finalize (lines %, sum %, subtotal %, discount % vs %)',
          OLD.id, v_line_count, v_line_sum, NEW.subtotal_paise, v_discount_sum, NEW.discount_paise
          USING ERRCODE = 'RB038';
      END IF;

      -- Every member order must already point back at this bill
      -- (orders.bill_id is set before the bill flips to FINALIZED).
      SELECT count(*), count(*) FILTER (WHERE o.bill_id IS DISTINCT FROM NEW.id)
        INTO v_members, v_unlinked
        FROM bill_order bo
        JOIN orders o ON o.tenant_id = bo.tenant_id AND o.id = bo.order_id
       WHERE bo.tenant_id = NEW.tenant_id AND bo.bill_id = NEW.id;
      IF v_members = 0 OR v_unlinked > 0 THEN
        RAISE EXCEPTION 'Bill % cannot be finalized: % of % member orders are not linked to it',
          OLD.id, v_unlinked, v_members USING ERRCODE = 'RB038';
      END IF;

    ELSE
      RAISE EXCEPTION 'Illegal bill transition % -> %', OLD.status, NEW.status USING ERRCODE = 'RB035';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD.status = 'FINALIZED'
  IF NEW.status = 'FINALIZED' THEN
    IF cardinality(v_changed) = 0 THEN
      RETURN NEW;
    END IF;
    IF v_changed && ARRAY['paid_paise', 'outstanding_paise'] AND v_depth <= 1 THEN
      RAISE EXCEPTION 'Settlement fields of bill % are owned by the payment settlement trigger', OLD.id
        USING ERRCODE = 'RB031';
    END IF;
    IF NOT (v_changed <@ ARRAY['paid_paise', 'outstanding_paise', 'version']) THEN
      RAISE EXCEPTION 'Snapshot fields % of FINALIZED bill % are immutable', v_changed, OLD.id
        USING ERRCODE = 'RB030';
    END IF;

  ELSIF NEW.status = 'PAID' THEN
    IF v_depth <= 1 THEN
      RAISE EXCEPTION 'Bill % may only become PAID through the payment settlement trigger', OLD.id
        USING ERRCODE = 'RB032';
    END IF;
    IF NOT (v_changed <@ ARRAY['status', 'paid_paise', 'outstanding_paise', 'version']) THEN
      RAISE EXCEPTION 'Settling bill % changed unexpected columns %', OLD.id, v_changed
        USING ERRCODE = 'RB030';
    END IF;

  ELSIF NEW.status = 'VOID' THEN
    IF OLD.paid_paise <> 0 THEN
      RAISE EXCEPTION 'Cannot void bill % with % paise already paid', OLD.id, OLD.paid_paise
        USING ERRCODE = 'RB033';
    END IF;
    IF NOT (v_changed <@ ARRAY['status', 'version', 'voided_at', 'voided_by', 'void_reason']) THEN
      RAISE EXCEPTION 'Voiding bill % must not touch the financial snapshot (changed %)', OLD.id, v_changed
        USING ERRCODE = 'RB030';
    END IF;
    SELECT count(*) INTO v_still_linked
      FROM orders WHERE tenant_id = OLD.tenant_id AND bill_id = OLD.id;
    IF v_still_linked > 0 THEN
      RAISE EXCEPTION 'Cannot void bill %: % order(s) are still linked to it', OLD.id, v_still_linked
        USING ERRCODE = 'RB034';
    END IF;

  ELSE
    RAISE EXCEPTION 'Illegal bill transition % -> %', OLD.status, NEW.status USING ERRCODE = 'RB035';
  END IF;

  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

-- 2. orders: billed-order protection. Narrow by design — while an order is
-- billed it must still accept the forward operational transitions the KDS
-- and the cashier need (session close requires every order terminal), so
-- status changes are NOT blocked wholesale, only the ones that would
-- invalidate the bill: CANCELLED, and reopening a COMPLETED order.
--
-- `bill_id` may only be set at finalize (bill still DRAFT) and cleared at void
-- (bill still FINALIZED), never re-pointed X -> Y. The bill row is read
-- FOR SHARE: a plain SELECT would use a statement snapshot that can predate a
-- concurrently committed status change, FOR SHARE waits for the conflicting
-- lock and reads the latest committed row.
CREATE OR REPLACE FUNCTION orders_billed_guard() RETURNS trigger AS $trigger$
DECLARE
  v_bill_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.bill_id IS NOT NULL THEN
      RAISE EXCEPTION 'An order cannot be inserted already billed' USING ERRCODE = 'RB011';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.table_session_id IS DISTINCT FROM OLD.table_session_id THEN
    RAISE EXCEPTION 'orders.table_session_id is immutable (order %)', OLD.id USING ERRCODE = 'RB002';
  END IF;

  IF OLD.bill_id IS NULL AND NEW.bill_id IS NOT NULL THEN
    -- NULL -> X: finalize links the order while the bill is still DRAFT.
    IF OLD.status = 'CANCELLED' OR NEW.status = 'CANCELLED' THEN
      RAISE EXCEPTION 'Cannot bill cancelled order %', OLD.id USING ERRCODE = 'RB009';
    END IF;
    SELECT status INTO v_bill_status
      FROM bill WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id FOR SHARE;
    IF v_bill_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'Order % can only be linked to a DRAFT bill (bill % is %)',
        OLD.id, NEW.bill_id, v_bill_status USING ERRCODE = 'RB010';
    END IF;

  ELSIF OLD.bill_id IS NOT NULL AND NEW.bill_id IS NULL THEN
    -- X -> NULL: void unlinks the order while the bill is still FINALIZED.
    SELECT status INTO v_bill_status
      FROM bill WHERE tenant_id = OLD.tenant_id AND id = OLD.bill_id FOR SHARE;
    IF v_bill_status IS DISTINCT FROM 'FINALIZED' THEN
      RAISE EXCEPTION 'Order % can only be unlinked from a FINALIZED bill (bill % is %)',
        OLD.id, OLD.bill_id, v_bill_status USING ERRCODE = 'RB006';
    END IF;

  ELSIF OLD.bill_id IS NOT NULL AND NEW.bill_id IS DISTINCT FROM OLD.bill_id THEN
    RAISE EXCEPTION 'Order % cannot be re-linked from bill % to bill %', OLD.id, OLD.bill_id, NEW.bill_id
      USING ERRCODE = 'RB005';

  ELSIF OLD.bill_id IS NOT NULL THEN
    -- Still billed after this UPDATE.
    IF NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise THEN
      RAISE EXCEPTION 'Cannot change the subtotal of billed order %', OLD.id USING ERRCODE = 'RB003';
    END IF;
    IF NEW.line_count IS DISTINCT FROM OLD.line_count THEN
      RAISE EXCEPTION 'Cannot change the line count of billed order %', OLD.id USING ERRCODE = 'RB004';
    END IF;
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
      RAISE EXCEPTION 'Cannot cancel billed order %', OLD.id USING ERRCODE = 'RB007';
    END IF;
    IF OLD.status = 'COMPLETED' AND NEW.status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'Cannot reopen billed order %', OLD.id USING ERRCODE = 'RB008';
    END IF;
  END IF;

  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

-- 3. order_line / order_line_addon: no mutation while the parent order is
-- billed. The parent is read FOR SHARE, not with a plain SELECT: the
-- service-level parent lock (`orders FOR UPDATE`) only protects writers that
-- take it, and an UPDATE of an existing child row takes no parent lock at all.
-- A plain read here would use a statement snapshot that can predate a
-- concurrently committed finalize and let the write through; FOR SHARE waits
-- for finalize's FOR UPDATE and then sees the committed bill_id.
CREATE OR REPLACE FUNCTION order_line_billed_guard() RETURNS trigger AS $trigger$
DECLARE
  v_tenant_id UUID;
  v_order_id UUID;
  v_bill_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id; v_order_id := OLD.order_id;
  ELSE
    v_tenant_id := NEW.tenant_id; v_order_id := NEW.order_id;
  END IF;

  SELECT bill_id INTO v_bill_id
    FROM orders WHERE tenant_id = v_tenant_id AND id = v_order_id FOR SHARE;
  IF v_bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order % is billed (bill %); its lines are immutable', v_order_id, v_bill_id
      USING ERRCODE = 'RB001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION order_line_addon_billed_guard() RETURNS trigger AS $trigger$
DECLARE
  v_tenant_id UUID;
  v_line_id UUID;
  v_bill_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id; v_line_id := OLD.order_line_id;
  ELSE
    v_tenant_id := NEW.tenant_id; v_line_id := NEW.order_line_id;
  END IF;

  SELECT o.bill_id INTO v_bill_id
    FROM order_line ol
    JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
   WHERE ol.tenant_id = v_tenant_id AND ol.id = v_line_id
     FOR SHARE OF o;
  IF v_bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order line % belongs to a billed order (bill %); add-ons are immutable',
      v_line_id, v_bill_id USING ERRCODE = 'RB001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

-- 4. bill_order / bill_line / bill_adjustment: only while the parent bill is
-- DRAFT (parent read FOR SHARE, same reasoning as above). bill_order also
-- enforces cross-session protection at the database: every order on a bill must
-- belong to the bill's table session (orders.table_session_id is immutable, so
-- a plain read of it is safe). bill_adjustment rejects the kinds V1 does not
-- support (TAX / SERVICE_CHARGE / DELIVERY_CHARGE / ROUNDING).
CREATE OR REPLACE FUNCTION bill_child_guard() RETURNS trigger AS $trigger$
DECLARE
  v_tenant_id UUID;
  v_bill_id UUID;
  v_bill_status TEXT;
  v_bill_session UUID;
  v_order_session UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id; v_bill_id := OLD.bill_id;
  ELSE
    v_tenant_id := NEW.tenant_id; v_bill_id := NEW.bill_id;
  END IF;

  SELECT status, table_session_id INTO v_bill_status, v_bill_session
    FROM bill WHERE tenant_id = v_tenant_id AND id = v_bill_id FOR SHARE;
  IF v_bill_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION '% rows can only change while their bill is DRAFT (bill % is %)',
      TG_TABLE_NAME, v_bill_id, v_bill_status USING ERRCODE = 'RB040';
  END IF;

  IF TG_TABLE_NAME = 'bill_order' AND TG_OP <> 'DELETE' THEN
    SELECT table_session_id INTO v_order_session
      FROM orders WHERE tenant_id = NEW.tenant_id AND id = NEW.order_id;
    IF v_order_session IS DISTINCT FROM v_bill_session THEN
      RAISE EXCEPTION 'Order % is not in the table session of bill %', NEW.order_id, v_bill_id
        USING ERRCODE = 'RB041';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'bill_adjustment' AND TG_OP <> 'DELETE' THEN
    IF NEW.kind NOT IN ('DISCOUNT_PERCENT', 'DISCOUNT_FIXED') THEN
      RAISE EXCEPTION 'Adjustment kind % is not supported in V1', NEW.kind USING ERRCODE = 'RB042';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

-- 5. payment: AFTER INSERT settlement (V1 payments are insert-only; there is
-- no UPDATE settlement logic).
--
-- Order matters. (1) Lock the bill row, (2) THEN, as a separate statement, sum
-- the SUCCEEDED payments. In READ COMMITTED every statement gets a fresh
-- snapshot, so this sum sees a payment another transaction committed while we
-- waited for the lock. Collapsing it into one `UPDATE bill SET paid = (SELECT
-- SUM ...)` would compute the sum under the snapshot taken BEFORE the wait:
-- two concurrent payments could commit with paid_paise reflecting only one
-- and every CHECK would still pass (silent drift). Lock first, sum second.
--
-- The lock is FOR NO KEY UPDATE, not FOR UPDATE, on purpose. The payment INSERT's
-- own foreign-key check has already taken FOR KEY SHARE on the bill row; two
-- concurrent inserters therefore both hold KEY SHARE, and FOR UPDATE (which
-- conflicts with KEY SHARE) makes each wait for the other to release it: a
-- lock-upgrade DEADLOCK (40P01), found by the raw parallel-insert test in
-- gate8-concurrency. FOR NO KEY UPDATE does not conflict with KEY SHARE, so the
-- FK locks coexist, yet it still conflicts with itself, with the service's
-- `SELECT ... FOR UPDATE` and with bill UPDATEs, so settlements stay serialized
-- and the lock-then-sum guarantee is unchanged. (The service path locks the bill
-- BEFORE inserting, so it never reaches this contention.)
CREATE OR REPLACE FUNCTION payment_settle() RETURNS trigger AS $trigger$
DECLARE
  v_status TEXT;
  v_grand BIGINT;
  v_paid BIGINT;
  v_outstanding BIGINT;
BEGIN
  IF NEW.status <> 'SUCCEEDED' THEN
    RETURN NEW;  -- reserved statuses (future gateway) settle nothing in V1
  END IF;

  SELECT status, grand_total_paise INTO v_status, v_grand
    FROM bill WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill % not found for payment %', NEW.bill_id, NEW.id USING ERRCODE = 'RB020';
  END IF;
  IF v_status <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Bill % is % and cannot take payments', NEW.bill_id, v_status USING ERRCODE = 'RB020';
  END IF;

  SELECT COALESCE(SUM(amount_paise), 0) INTO v_paid
    FROM payment
   WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.bill_id AND status = 'SUCCEEDED';

  IF v_paid > v_grand THEN
    RAISE EXCEPTION 'Overpayment on bill %: paid % exceeds grand total %', NEW.bill_id, v_paid, v_grand
      USING ERRCODE = 'RB021';
  END IF;
  v_outstanding := v_grand - v_paid;

  -- Depth 2 here: bill_guard permits exactly these DB-owned columns.
  UPDATE bill
     SET paid_paise = v_paid,
         outstanding_paise = v_outstanding,
         status = CASE WHEN v_outstanding = 0 THEN 'PAID' ELSE status END,
         version = version + 1
   WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id;

  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

-- Gate 10: Guard that rejects expense INSERT or category change when the category
-- is soft-deleted, inactive, or not found.
CREATE OR REPLACE FUNCTION check_category_active_on_expense() RETURNS trigger AS $trigger$
DECLARE
  v_is_active BOOLEAN;
  v_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT is_active, deleted_at INTO v_is_active, v_deleted_at
    FROM expense_category
   WHERE tenant_id = NEW.tenant_id AND id = NEW.category_id;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'RB050: Referenced expense category does not exist or has been deleted';
  END IF;

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'RB051: Referenced expense category is inactive';
  END IF;

  RETURN NEW;
END;
$trigger$ LANGUAGE plpgsql;

-- Attachments (guarded like the Gate 6 block above; names are chosen so every
-- guard sorts before `set_updated_at` and before `recompute_*`).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bill') THEN
    DROP TRIGGER IF EXISTS bill_guard ON bill;
    CREATE TRIGGER bill_guard
      BEFORE INSERT OR UPDATE ON bill
      FOR EACH ROW EXECUTE FUNCTION bill_guard();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders')
     AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.orders'::regclass
                   AND attname = 'bill_id' AND NOT attisdropped) THEN
    DROP TRIGGER IF EXISTS orders_billed_guard ON orders;
    CREATE TRIGGER orders_billed_guard
      BEFORE INSERT OR UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION orders_billed_guard();

    DROP TRIGGER IF EXISTS order_line_billed_guard ON order_line;
    CREATE TRIGGER order_line_billed_guard
      BEFORE INSERT OR UPDATE OR DELETE ON order_line
      FOR EACH ROW EXECUTE FUNCTION order_line_billed_guard();

    DROP TRIGGER IF EXISTS order_line_addon_billed_guard ON order_line_addon;
    CREATE TRIGGER order_line_addon_billed_guard
      BEFORE INSERT OR UPDATE OR DELETE ON order_line_addon
      FOR EACH ROW EXECUTE FUNCTION order_line_addon_billed_guard();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bill_order') THEN
    DROP TRIGGER IF EXISTS bill_order_guard ON bill_order;
    CREATE TRIGGER bill_order_guard
      BEFORE INSERT OR UPDATE OR DELETE ON bill_order
      FOR EACH ROW EXECUTE FUNCTION bill_child_guard();

    DROP TRIGGER IF EXISTS bill_line_guard ON bill_line;
    CREATE TRIGGER bill_line_guard
      BEFORE INSERT OR UPDATE OR DELETE ON bill_line
      FOR EACH ROW EXECUTE FUNCTION bill_child_guard();

    DROP TRIGGER IF EXISTS bill_adjustment_guard ON bill_adjustment;
    CREATE TRIGGER bill_adjustment_guard
      BEFORE INSERT OR UPDATE OR DELETE ON bill_adjustment
      FOR EACH ROW EXECUTE FUNCTION bill_child_guard();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payment') THEN
    DROP TRIGGER IF EXISTS payment_settle ON payment;
    CREATE TRIGGER payment_settle
      AFTER INSERT ON payment
      FOR EACH ROW EXECUTE FUNCTION payment_settle();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'expense') THEN
    DROP TRIGGER IF EXISTS expense_category_active_guard ON expense;
    CREATE TRIGGER expense_category_active_guard
      BEFORE INSERT OR UPDATE OF category_id ON expense
      FOR EACH ROW EXECUTE FUNCTION check_category_active_on_expense();
  END IF;
END
$$;

