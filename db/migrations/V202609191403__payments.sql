-- Gate 8 (Implementation Blueprint section 5, stage 7 `payments`;
-- architecture section 9 "Payments"): the payment ledger.
--
-- V1 payments are INSERT-ONLY settlement entries (status SUCCEEDED, methods
-- CASH / UPI_STATIC): there is no V1 UPDATE or DELETE path, so R__grants.sql
-- withholds UPDATE/DELETE from app_rw (the order_status_history pattern), the
-- table has no `updated_at` (so the generic set_updated_at trigger never
-- attaches), and the settlement trigger is AFTER INSERT only.
--
-- PENDING / FAILED / REVERSED stay in the status CHECK because the
-- architecture reserves them for the future gateway/refund flow; no V1 code
-- path produces them. There is no cash-tendered / change column: change-giving
-- is a UI calculation, not a payment (architecture section 9).

CREATE TABLE payment (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  bill_id UUID NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 9007199254740991),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'UPI_STATIC')),
  status TEXT NOT NULL DEFAULT 'SUCCEEDED'
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  provider TEXT NOT NULL DEFAULT 'manual',
  -- UPI: the UTR the cashier types (anti-fraud control, architecture section 9).
  provider_reference TEXT,
  provider_status TEXT,
  provider_payload JSONB,
  reference_note TEXT,
  received_by UUID NOT NULL REFERENCES "user" (id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Static UPI / cash: the cashier is both receiver and verifier.
  verified_by UUID REFERENCES "user" (id),
  verified_at TIMESTAMPTZ,
  idempotency_key UUID NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, bill_id) REFERENCES bill (tenant_id, id)
);
CREATE UNIQUE INDEX payment_tenant_idempotency_key_unique ON payment (tenant_id, idempotency_key);
CREATE INDEX payment_tenant_bill_idx ON payment (tenant_id, bill_id);
CREATE INDEX payment_tenant_received_at_idx ON payment (tenant_id, received_at);
