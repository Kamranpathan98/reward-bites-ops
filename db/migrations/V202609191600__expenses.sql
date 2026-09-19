-- Gate 10 (Implementation Blueprint section 5, stage 8 `expenses`;
-- architecture section 10 "Expenses" and section 11 table catalog):
-- expense_category, expense.
--
-- Conventions followed strictly:
--   * ids are server-generated UUID v7 (no DB default),
--   * composite PK/unique on (tenant_id, id),
--   * money is BIGINT paise (amount_paise > 0, <= 9007199254740991),
--   * payment_method is TEXT + CHECK (CASH, UPI, BANK_TRANSFER, CARD, OTHER),
--   * all tables carry tenant_id and pick up forced RLS from R__rls_policies.sql,
--   * grants managed in R__grants.sql (SELECT, INSERT, UPDATE on both; DELETE revoked from app_rw).

CREATE TABLE expense_category (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);

-- Canonical architecture constraint: UNIQUE (tenant_id, name) WHERE deleted_at IS NULL
CREATE UNIQUE INDEX expense_category_tenant_name_unique
  ON expense_category (tenant_id, name)
  WHERE deleted_at IS NULL;

CREATE TABLE expense (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  category_id UUID NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 9007199254740991),
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER')),
  version INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES "user" (id),
  updated_by UUID REFERENCES "user" (id),
  idempotency_key UUID NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES expense_category (tenant_id, id)
);

CREATE UNIQUE INDEX expense_tenant_idempotency_key_unique
  ON expense (tenant_id, idempotency_key);

CREATE INDEX expense_tenant_date_idx
  ON expense (tenant_id, expense_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX expense_tenant_category_idx
  ON expense (tenant_id, category_id)
  WHERE deleted_at IS NULL;

