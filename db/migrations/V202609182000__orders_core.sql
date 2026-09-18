-- Stage 5 / Gate 6 (Implementation Blueprint section 5 row 191;
-- architecture section 8 "Order"): orders (no bill_id yet), order_line,
-- order_line_addon, order_status_history. All four carry tenant_id and pick
-- up RLS + grants automatically from the dynamic, catalog-driven
-- R__rls_policies.sql / R__grants.sql — no bespoke policy needed (nothing
-- reads these before a tenant context exists; Public Ordering is Gate 11).
--
-- `orders.bill_id` is deliberately NOT created here. Blueprint section 5's
-- own note: "orders.bill_id references bill(id), but bill_order and
-- bill_line reference orders(id) — a forward-reference cycle... resolved by
-- creating orders WITHOUT bill_id first... and only then running an ALTER
-- TABLE orders ADD COLUMN bill_id ... REFERENCES bill(id) migration once
-- bill exists." That ALTER is Gate 8's orders_bill_link migration.
--
-- `order_number` is stored as TEXT ("#0042" — architecture section 8,
-- verbatim example), assigned from tenant_counter under a per-tenant daily
-- reset (the `reset_daily` column tenant_counter already carries, unused
-- until now). Zero-padded to 4 digits — the exact padding width isn't
-- specified beyond the example; this is the narrowest choice matching it.

-- Gate 4 defect fix, discovered here (live Postgres, not static review):
-- `table_session` never got a `UNIQUE (tenant_id, id)` composite constraint
-- — every other tenant-owned table that's a composite-FK *target* has one
-- (restaurant_table, menu_category, menu_item, ...), but table_session was
-- missed. `orders` needs `FOREIGN KEY (tenant_id, table_session_id)
-- REFERENCES table_session (tenant_id, id)`, which Postgres cannot create
-- without a matching unique constraint on the referenced columns.
-- V202609181000__tables_qr_sessions.sql is already applied (its checksum is
-- locked), so this is fixed forward with an ALTER here rather than editing
-- that file — the same staged-migration technique the blueprint itself
-- uses for `orders.bill_id`.
ALTER TABLE table_session ADD CONSTRAINT table_session_tenant_id_unique UNIQUE (tenant_id, id);

CREATE TABLE orders (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  table_session_id UUID NOT NULL,
  order_number TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('QR_DINE_IN', 'COUNTER')),
  type TEXT NOT NULL CHECK (type IN ('DINE_IN', 'TAKEAWAY')),
  channel_ref TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_id UUID,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')),
  version INT NOT NULL DEFAULT 0,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  cancelled_by UUID REFERENCES "user" (id),
  subtotal_paise BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  line_count INT NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  notes TEXT,
  idempotency_key UUID NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  created_by UUID REFERENCES "user" (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, table_session_id) REFERENCES table_session (tenant_id, id)
);
CREATE UNIQUE INDEX orders_tenant_idempotency_key_unique ON orders (tenant_id, idempotency_key);
CREATE INDEX orders_tenant_placed_at_idx ON orders (tenant_id, placed_at DESC);
CREATE INDEX orders_tenant_status_idx ON orders (tenant_id, status);
CREATE INDEX orders_tenant_session_idx ON orders (tenant_id, table_session_id);
-- Trigram search on customer_name / order_number (architecture section 11:
-- "GET /orders ... q (customer name / order number)"; section 15: "ILIKE ...
-- with pg_trgm GIN index"). pg_trgm was enabled in Gate 1's V..._extensions.
CREATE INDEX orders_customer_name_trgm_idx ON orders USING gin (customer_name gin_trgm_ops);
CREATE INDEX orders_order_number_trgm_idx ON orders USING gin (order_number gin_trgm_ops);

-- `line_total_paise` is trigger-maintained (R__triggers.sql), never a
-- same-row CHECK — it depends on child order_line_addon rows, which a CHECK
-- constraint cannot see. Architecture section 8, verbatim column list.
CREATE TABLE order_line (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  order_id UUID NOT NULL,
  menu_item_id UUID NOT NULL,
  menu_variant_id UUID,
  item_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  qty INT NOT NULL CHECK (qty > 0),
  line_total_paise BIGINT NOT NULL DEFAULT 0 CHECK (line_total_paise >= 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES "user" (id),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, id),
  FOREIGN KEY (tenant_id, menu_item_id) REFERENCES menu_item (tenant_id, id),
  FOREIGN KEY (tenant_id, menu_variant_id) REFERENCES menu_variant (tenant_id, id)
);
CREATE INDEX order_line_tenant_order_idx ON order_line (tenant_id, order_id);

-- No surrogate `id` — architecture section 8 lists this table's columns as
-- exactly `order_line_id, addon_id, name_snapshot, unit_price_paise, qty`,
-- unlike order_line (which explicitly has `id`). Composite PK, mirroring
-- menu_item_addon's established junction-table pattern exactly.
CREATE TABLE order_line_addon (
  tenant_id UUID NOT NULL,
  order_line_id UUID NOT NULL,
  addon_id UUID NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  qty INT NOT NULL CHECK (qty > 0),
  PRIMARY KEY (tenant_id, order_line_id, addon_id),
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES order_line (tenant_id, id),
  FOREIGN KEY (tenant_id, addon_id) REFERENCES menu_addon (tenant_id, id)
);

-- Append-only audit trail for status transitions (architecture section 8:
-- "this is the audit trail for orders and it is append-only — no
-- UPDATE/DELETE grant for app_rw"). R__grants.sql already special-cases
-- this exact table name (added preemptively alongside audit_event back in
-- Gate 2, per that file's own comment) — no grants edit needed this gate,
-- only the repeatable checksum-bump touch.
CREATE TABLE order_status_history (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  order_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'customer', 'system', 'platform')),
  actor_id UUID,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, id)
);
CREATE INDEX order_status_history_tenant_order_idx ON order_status_history (tenant_id, order_id);
