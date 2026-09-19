-- Gate 8 (Implementation Blueprint section 5, stage 6 `billing_core`;
-- architecture section 9 "Bill" and section 11 table catalog): bill,
-- bill_order, bill_line, bill_adjustment.
--
-- Conventions followed exactly (architecture section 11 "Conventions"):
--   * ids are server-generated UUID v7 (no DB default), enums are TEXT + CHECK
--     (ADR-017), money is BIGINT paise, every tenant-owned FK is composite on
--     (tenant_id, id), and no FK uses CASCADE / SET NULL — financial history is
--     never destroyed by a referential action (default NO ACTION).
--   * All four tables carry tenant_id, so RLS + grants come from the dynamic
--     R__rls_policies.sql / R__grants.sql (grants get explicit exceptions in
--     R__grants.sql; the immutability guards live in R__triggers.sql).
--
-- Money upper bound: every Gate 8 money column is CHECKed to
-- Number.MAX_SAFE_INTEGER (9007199254740991) so BIGINT values always convert
-- to a JS number exactly (Gate 8 plan, money safety).
--
-- `orders.bill_id` is NOT created here (forward-reference cycle, see
-- V202609182000__orders_core.sql) — V..._orders_bill_link adds it.

-- Required by bill_line's (tenant_id, order_id, order_line_id) provenance FK: a
-- bill_line must provably reference a line of *that* order, which two
-- independent single-column FKs cannot express.
ALTER TABLE order_line
  ADD CONSTRAINT order_line_tenant_order_id_unique UNIQUE (tenant_id, order_id, id);

CREATE TABLE bill (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  table_session_id UUID NOT NULL,
  -- Assigned only at finalization from tenant_counter('bill_number'):
  -- monotonically increasing per tenant, gaps acceptable, NULL for drafts.
  bill_number BIGINT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'FINALIZED', 'PAID', 'DISCARDED', 'VOID')),
  subtotal_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  tax_paise BIGINT NOT NULL DEFAULT 0,
  service_charge_paise BIGINT NOT NULL DEFAULT 0,
  delivery_charge_paise BIGINT NOT NULL DEFAULT 0,
  -- Signed: round-to-rupee moves the total by -49..+50 paise.
  rounding_paise BIGINT NOT NULL DEFAULT 0,
  grand_total_paise BIGINT NOT NULL DEFAULT 0,
  -- paid_paise / outstanding_paise are database-owned (payment settlement
  -- trigger); service code never writes them (ADR-024).
  paid_paise BIGINT NOT NULL DEFAULT 0,
  outstanding_paise BIGINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 0,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES "user" (id),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES "user" (id),
  void_reason TEXT,
  customer_name TEXT,
  notes TEXT,
  idempotency_key UUID NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  created_by UUID REFERENCES "user" (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, table_session_id) REFERENCES table_session (tenant_id, id),

  CONSTRAINT bill_money_range CHECK (
    subtotal_paise BETWEEN 0 AND 9007199254740991
    AND discount_paise BETWEEN 0 AND 9007199254740991
    AND tax_paise BETWEEN 0 AND 9007199254740991
    AND service_charge_paise BETWEEN 0 AND 9007199254740991
    AND delivery_charge_paise BETWEEN 0 AND 9007199254740991
    AND grand_total_paise BETWEEN 0 AND 9007199254740991
    AND paid_paise BETWEEN 0 AND 9007199254740991
    AND outstanding_paise BETWEEN 0 AND 9007199254740991
  ),
  -- Half-up rounding to the rupee: P mod 100 in 0..49 rounds down (-49..0),
  -- 50..99 rounds up (+50..+1).
  CONSTRAINT bill_rounding_range CHECK (rounding_paise BETWEEN -49 AND 50),
  CONSTRAINT bill_grand_total_formula CHECK (
    grand_total_paise = subtotal_paise - discount_paise + tax_paise
      + service_charge_paise + delivery_charge_paise + rounding_paise
  ),
  CONSTRAINT bill_outstanding_formula CHECK (outstanding_paise = grand_total_paise - paid_paise),
  CONSTRAINT bill_paid_within_total CHECK (paid_paise <= grand_total_paise),
  CONSTRAINT bill_discount_within_subtotal CHECK (discount_paise <= subtotal_paise),
  -- V1 scope: no tax / service charge / delivery charge engines. A future
  -- migration drops this CHECK when those modules ship.
  CONSTRAINT bill_v1_no_tax_service_delivery CHECK (
    tax_paise = 0 AND service_charge_paise = 0 AND delivery_charge_paise = 0
  ),
  -- bill_number and finalized_at exist exactly for bills that were finalized.
  CONSTRAINT bill_number_iff_finalized CHECK (
    (status IN ('DRAFT', 'DISCARDED')) = (bill_number IS NULL)
  ),
  CONSTRAINT bill_finalized_at_iff_finalized CHECK (
    (status IN ('DRAFT', 'DISCARDED')) = (finalized_at IS NULL)
  ),
  CONSTRAINT bill_void_fields CHECK (
    (status = 'VOID') = (voided_at IS NOT NULL)
    AND (status <> 'VOID' OR (voided_by IS NOT NULL AND length(btrim(void_reason)) > 0))
  ),
  -- Settled means nothing left to pay; nothing is paid on a bill that never
  -- became payable (or that was voided — void requires paid = 0).
  CONSTRAINT bill_paid_implies_no_outstanding CHECK (status <> 'PAID' OR outstanding_paise = 0),
  CONSTRAINT bill_unpaid_states CHECK (
    status NOT IN ('DRAFT', 'DISCARDED', 'VOID') OR paid_paise = 0
  ),
  -- Zero-total bills are unsupported in V1: a zero bill could never be paid
  -- (payments require amount > 0) and would trap its session open forever.
  CONSTRAINT bill_live_total_positive CHECK (
    status NOT IN ('FINALIZED', 'PAID', 'VOID') OR grand_total_paise > 0
  )
);
CREATE UNIQUE INDEX bill_tenant_idempotency_key_unique ON bill (tenant_id, idempotency_key);
CREATE UNIQUE INDEX bill_tenant_bill_number_unique ON bill (tenant_id, bill_number);
CREATE INDEX bill_tenant_session_status_idx ON bill (tenant_id, table_session_id, status);
CREATE INDEX bill_tenant_status_idx ON bill (tenant_id, status);
CREATE INDEX bill_tenant_finalized_at_idx ON bill (tenant_id, finalized_at);
CREATE INDEX bill_tenant_created_at_idx ON bill (tenant_id, created_at DESC, id DESC);

-- Historical association (never deleted, not even on void). The CURRENT bill
-- of an order is `orders.bill_id`, never a lookup on bill_order.order_id
-- alone: an order may appear here under several bills over its lifetime
-- (e.g. bill 101 voided, then bill 102), which is why the PK is NOT unique on
-- order_id. INSERT-only for app_rw (R__grants.sql); membership is fixed at
-- draft creation in V1.
CREATE TABLE bill_order (
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  bill_id UUID NOT NULL,
  order_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, bill_id, order_id),
  FOREIGN KEY (tenant_id, bill_id) REFERENCES bill (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, id)
);
CREATE INDEX bill_order_tenant_order_idx ON bill_order (tenant_id, order_id);

-- Frozen order-line snapshots. V1 representation of add-ons: every ACTIVE
-- order_line becomes one ITEM row and each of its order_line_addon rows
-- becomes its own ADDON row (both carry the same order_line_id). This is the
-- only representation consistent with the existing order-line formula
--   line_total = unit_price * qty + SUM(addon_unit_price * addon_qty)
-- (add-on qty is NOT multiplied by the parent line qty): every row then
-- satisfies line_total = qty * unit_price, and the rows of one order line sum
-- to order_line.line_total_paise.
CREATE TABLE bill_line (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  bill_id UUID NOT NULL,
  order_id UUID NOT NULL,
  order_line_id UUID NOT NULL,
  line_kind TEXT NOT NULL CHECK (line_kind IN ('ITEM', 'ADDON')),
  addon_id UUID,
  description TEXT NOT NULL,
  qty INT NOT NULL CHECK (qty > 0),
  unit_price_paise BIGINT NOT NULL,
  line_total_paise BIGINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- The order must be a member of THIS bill...
  FOREIGN KEY (tenant_id, bill_id, order_id) REFERENCES bill_order (tenant_id, bill_id, order_id),
  -- ...and the line must belong to that order.
  FOREIGN KEY (tenant_id, order_id, order_line_id) REFERENCES order_line (tenant_id, order_id, id),
  -- MATCH SIMPLE: only ADDON rows (addon_id NOT NULL) are checked.
  FOREIGN KEY (tenant_id, order_line_id, addon_id)
    REFERENCES order_line_addon (tenant_id, order_line_id, addon_id),
  CONSTRAINT bill_line_money_range CHECK (
    unit_price_paise BETWEEN 0 AND 9007199254740991
    AND line_total_paise BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT bill_line_total_formula CHECK (line_total_paise = qty * unit_price_paise),
  CONSTRAINT bill_line_kind_addon CHECK ((line_kind = 'ADDON') = (addon_id IS NOT NULL))
);
-- Each order line / add-on is copied exactly once per bill.
CREATE UNIQUE INDEX bill_line_item_once_unique
  ON bill_line (tenant_id, bill_id, order_line_id) WHERE line_kind = 'ITEM';
CREATE UNIQUE INDEX bill_line_addon_once_unique
  ON bill_line (tenant_id, bill_id, order_line_id, addon_id) WHERE line_kind = 'ADDON';
CREATE INDEX bill_line_tenant_bill_sort_idx ON bill_line (tenant_id, bill_id, sort_order);

-- V1 holds discounts only (architecture section 9); the other kinds are
-- reserved in the CHECK and rejected by the bill_adjustment guard trigger.
-- Rounding lives solely in the signed bill.rounding_paise column.
CREATE TABLE bill_adjustment (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  bill_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('DISCOUNT_PERCENT', 'DISCOUNT_FIXED', 'TAX', 'SERVICE_CHARGE', 'DELIVERY_CHARGE', 'ROUNDING')
  ),
  label TEXT NOT NULL,
  basis_bp INT CHECK (basis_bp BETWEEN 1 AND 10000),
  amount_paise BIGINT NOT NULL CHECK (amount_paise BETWEEN 0 AND 9007199254740991),
  applied_by UUID REFERENCES "user" (id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, bill_id) REFERENCES bill (tenant_id, id),
  CONSTRAINT bill_adjustment_percent_has_basis CHECK ((kind = 'DISCOUNT_PERCENT') = (basis_bp IS NOT NULL))
);
-- Other adjustment kinds may coexist later, so uniqueness is per discount
-- only: at most one active discount per bill (V1).
CREATE UNIQUE INDEX bill_adjustment_one_discount_unique
  ON bill_adjustment (tenant_id, bill_id) WHERE kind IN ('DISCOUNT_PERCENT', 'DISCOUNT_FIXED');
CREATE INDEX bill_adjustment_tenant_bill_idx ON bill_adjustment (tenant_id, bill_id);
