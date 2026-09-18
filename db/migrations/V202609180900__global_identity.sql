-- Stage 1 (Implementation Blueprint section 5): user, refresh_token,
-- login_attempt, platform_admin. None carry tenant_id — these are global
-- identity tables, not tenant-owned data, so no RLS policy applies to them
-- (architecture section 6: RLS is driven off tenant_id; these tables have
-- none). Application code, not Postgres, generates ids as UUID v7
-- (architecture section 11): "the browser never mints entity ids," and
-- likewise no table here defaults `id` via a server-side function.

CREATE TABLE "user" (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  security_version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_unique ON "user" (lower(email));

CREATE TABLE refresh_token (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES "user" (id),
  -- Nullable: a token minted at login before a tenant is selected has no
  -- membership yet. FK added in V..._tenant_core once tenant_membership
  -- exists (same forward-reference technique as orders/bill in section 5).
  membership_id UUID,
  token_hash TEXT NOT NULL,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_token (id),
  device_label TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_token_token_hash_unique ON refresh_token (token_hash);
CREATE INDEX refresh_token_family_id_idx ON refresh_token (family_id);
CREATE INDEX refresh_token_user_id_idx ON refresh_token (user_id);

CREATE TABLE login_attempt (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL
);
CREATE INDEX login_attempt_email_at_idx ON login_attempt (email, at);

CREATE TABLE platform_admin (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  security_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admin_email_unique ON platform_admin (lower(email));
