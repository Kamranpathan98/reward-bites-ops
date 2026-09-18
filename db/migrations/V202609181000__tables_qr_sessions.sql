-- Stage 3 / Gate 4 (Implementation Blueprint section 5, row 189; architecture
-- section 11 table catalog, lines 437-439): restaurant_table, table_qr_token,
-- table_session. All three carry tenant_id and pick up RLS + grants
-- automatically from the dynamic, catalog-driven R__rls_policies.sql /
-- R__grants.sql — except table_qr_token, which needs a bespoke RLS policy
-- (see R__rls_policies.sql) because `app_public` must be able to resolve a
-- token with NO app.tenant_id context set yet; that policy is amended in the
-- same commit as this migration.

CREATE TABLE restaurant_table (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  capacity INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX restaurant_table_tenant_name_unique
  ON restaurant_table (tenant_id, name) WHERE deleted_at IS NULL;

CREATE TABLE table_qr_token (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  table_id UUID NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES "user" (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES restaurant_table (tenant_id, id)
);
CREATE UNIQUE INDEX table_qr_token_token_unique ON table_qr_token (token);
-- The constraint that actually prevents two ACTIVE tokens ever existing for
-- the same table at once (blueprint's "one ACTIVE token per table" concurrency
-- requirement) — a regenerate that revokes-old-then-inserts-new inside a
-- single transaction relies on this to make a concurrent regenerate on the
-- same table fail loudly (unique violation) rather than silently race.
CREATE UNIQUE INDEX table_qr_token_tenant_table_active_unique
  ON table_qr_token (tenant_id, table_id) WHERE status = 'ACTIVE';

CREATE TABLE table_session (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  table_id UUID,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  session_token TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opened_by_user_id UUID REFERENCES "user" (id),
  force_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES restaurant_table (tenant_id, id)
);
CREATE UNIQUE INDEX table_session_session_token_unique ON table_session (session_token);
-- The partial unique index Gate 4's own concurrency test targets: two
-- simultaneous attempts to open a session for the same table can insert
-- concurrently, but only one commits — the loser gets a unique violation,
-- never a second OPEN session on the same table.
CREATE UNIQUE INDEX table_session_tenant_table_open_unique
  ON table_session (tenant_id, table_id) WHERE status = 'OPEN' AND table_id IS NOT NULL;
