-- Stage 4 / Gate 5 (Implementation Blueprint section 5 row 190; architecture
-- section 10 "Menu"): menu_category, menu_item, menu_variant, menu_addon,
-- menu_item_addon. All five carry tenant_id and pick up RLS + grants
-- automatically from the dynamic, catalog-driven R__rls_policies.sql /
-- R__grants.sql / R__triggers.sql — no bespoke policy needed this gate
-- (unlike table_qr_token in Gate 4): nothing reads these tables before a
-- tenant context exists, since public menu resolution is explicitly out of
-- scope until Gate 11.
--
-- `image_key` exists on menu_item (architecture's own column list, section
-- 10) but the upload-url/confirm endpoints and the `image_asset` table
-- (blueprint stage 9) are deliberately NOT built this gate — no R2/S3
-- credentials exist in this environment (R2_ACCOUNT_ID etc. are still
-- unset, same class of deferral as Gate 4's QR domain). The column is
-- schema-complete and forward-compatible; nothing writes to it yet.

CREATE TABLE menu_category (
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
CREATE UNIQUE INDEX menu_category_tenant_name_unique
  ON menu_category (tenant_id, name) WHERE deleted_at IS NULL;

-- `veg_flag` values (VEG/NON_VEG/EGG) are an implementation-detail choice —
-- architecture section 10 says only "nullable enum, useful in India"
-- without naming the values. TEXT + CHECK, not a Postgres enum, per the
-- established convention (every status-like column in Gates 1-4).
CREATE TABLE menu_item (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  category_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_key TEXT,
  base_price_paise INT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  veg_flag TEXT CHECK (veg_flag IN ('VEG', 'NON_VEG', 'EGG')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES menu_category (tenant_id, id),
  CHECK (base_price_paise IS NULL OR base_price_paise >= 0)
);
CREATE UNIQUE INDEX menu_item_tenant_category_name_unique
  ON menu_item (tenant_id, category_id, name) WHERE deleted_at IS NULL;

-- "base_price_paise IS NOT NULL OR EXISTS variant" is explicitly stated by
-- the architecture as "enforced in service" (section 10), not a DB CHECK —
-- deliberately not added here; MenuService validates it (see
-- apps/api/src/modules/menu/menu.service.ts).

CREATE TABLE menu_variant (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  item_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_paise INT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_item (tenant_id, id),
  CHECK (price_paise >= 0)
);
CREATE UNIQUE INDEX menu_variant_tenant_item_name_unique
  ON menu_variant (tenant_id, item_id, name) WHERE deleted_at IS NULL;

-- Tenant-scoped, reusable across items (architecture: "menu_item }o--o{
-- menu_addon: offers") — no per-tenant name-uniqueness constraint is stated
-- for menu_addon, unlike category/item/variant, so none is added here.
CREATE TABLE menu_addon (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenant (id),
  name TEXT NOT NULL,
  price_paise INT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK (price_paise >= 0)
);

CREATE TABLE menu_item_addon (
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  addon_id UUID NOT NULL,
  max_qty INT NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, item_id, addon_id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_item (tenant_id, id),
  FOREIGN KEY (tenant_id, addon_id) REFERENCES menu_addon (tenant_id, id),
  CHECK (max_qty >= 1)
);
