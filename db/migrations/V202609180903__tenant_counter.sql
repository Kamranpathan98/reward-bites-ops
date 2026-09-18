-- Stage 2 (Implementation Blueprint section 5): sequences for human-facing
-- numbers (order_number, bill_number, ...), locked FOR UPDATE per use.
-- No rows are inserted here — the owning module inserts its own counter
-- row the first time it needs one (e.g. `INSERT ... ON CONFLICT DO NOTHING`
-- before the `SELECT ... FOR UPDATE`); none of that exists until orders
-- ship in a later gate.

CREATE TABLE tenant_counter (
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  counter_name TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  reset_daily BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, counter_name)
);
