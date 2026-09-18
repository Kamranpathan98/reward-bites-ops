-- Stage 2 (Implementation Blueprint section 5): tenant, tenant_settings,
-- role, role_permission, tenant_membership. All except `tenant` itself
-- carry tenant_id and pick up RLS + grants automatically from the dynamic,
-- catalog-driven R__rls_policies.sql / R__grants.sql written in Gate 1.
-- `tenant` has no tenant_id (architecture section 11: "no tenant_id; RLS:
-- platform role or own id") and gets a hand-written policy for that in
-- R__rls_policies.sql.

CREATE TABLE tenant (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  logo_key TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenant_slug_unique ON tenant (slug);

CREATE TABLE tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenant (id),
  orders_workflow TEXT NOT NULL DEFAULT 'SIMPLE' CHECK (orders_workflow IN ('SIMPLE', 'KITCHEN')),
  qr_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  customer_name_required BOOLEAN NOT NULL DEFAULT false,
  auto_accept BOOLEAN NOT NULL DEFAULT false,
  kitchen_display_enabled BOOLEAN NOT NULL DEFAULT false,
  print_slip_on_new BOOLEAN NOT NULL DEFAULT false,
  cash_enabled BOOLEAN NOT NULL DEFAULT true,
  upi_enabled BOOLEAN NOT NULL DEFAULT false,
  upi_id TEXT,
  upi_reference_required BOOLEAN NOT NULL DEFAULT true,
  paper TEXT NOT NULL DEFAULT '80mm',
  bill_footer TEXT,
  round_to_rupee BOOLEAN NOT NULL DEFAULT false,
  max_discount_bp INT NOT NULL DEFAULT 5000,
  business_day_starts_at TIME NOT NULL DEFAULT '04:00',
  extra JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE role_permission (
  tenant_id UUID NOT NULL,
  role_id UUID NOT NULL,
  permission_key TEXT NOT NULL REFERENCES permission (key),
  PRIMARY KEY (tenant_id, role_id, permission_key),
  FOREIGN KEY (tenant_id, role_id) REFERENCES role (tenant_id, id)
);

CREATE TABLE tenant_membership (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  user_id UUID NOT NULL REFERENCES "user" (id),
  role_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  invited_by UUID REFERENCES "user" (id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES role (tenant_id, id)
);

-- Close the forward reference from refresh_token now that tenant_membership exists.
ALTER TABLE refresh_token
  ADD CONSTRAINT refresh_token_membership_id_fkey
  FOREIGN KEY (membership_id) REFERENCES tenant_membership (id);
