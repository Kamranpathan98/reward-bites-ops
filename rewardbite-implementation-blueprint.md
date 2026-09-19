# RewardBite — Implementation Blueprint
Derived from the locked `Restaurant SaaS Platform — V1 Architecture` document. No architectural decisions are reopened here; this converts the lock into an executable plan.

---

## 1. Architecture Lock Confirmation

- The architecture is **LOCKED**. This blueprint sequences and operationalizes it; it does not redesign it.
- **PostgreSQL is the only datastore.** No MongoDB, no Redis, no Kafka/RabbitMQ, no Elasticsearch, no ORM, no Docker for V1.
- This is a **greenfield** project. There is no legacy system, no data migration from any prior store.
- **No application source code is written in this document.** No files beyond this blueprint are created.
- The blueprint preserves: RLS-enforced multi-tenancy, the modular monolith, `Table Session → Order → Bill → Payment`, `orders.bill_id` as the live-bill link, database-owned financial invariants, optimistic + pessimistic locking, idempotency-by-fingerprint, the fixed order state machine, polling-based realtime, and the Cloudflare + Render + Postgres + R2 deployment target.

### Implementation-oriented architecture summary

| Layer | Locked choice |
| --- | --- |
| Frontend | React + Vite + TypeScript SPA, Tailwind + shadcn/ui, two route trees (`/t/*` `/o/*` public, `/app/*` staff), TanStack Query for all server state |
| Backend | NestJS modular monolith, 14 modules with an enforced one-directional dependency graph, raw SQL via `pg` (no ORM; Kysely only if later explicitly approved) |
| Data | PostgreSQL, RLS **forced** on every tenant table, three DB roles (`app_rw`, `app_public`, `app_platform`) plus `app_migrator`, `SET LOCAL` tenant context per transaction |
| Domain | Table Session → Order → Bill → Payment as four separate aggregates; menu prices snapshotted into order/bill lines, never re-derived |
| Consistency | Optimistic `version` columns + `SELECT ... FOR UPDATE` row locks inside short transactions; idempotency key + body fingerprint on every money/order-creating write |
| Realtime | TanStack Query polling (3–5 s) on kitchen/cashier screens; no WebSockets in V1 |
| Deployment | Cloudflare (DNS/WAF/Pages) + Render (API + Postgres Standard) + Cloudflare R2 (images), no containers |

Three endpoint trust classes carry through every layer of this blueprint: **public** (`/p/*`, QR/order token, `app_public` then `app_rw`), **tenant** (`/*`, JWT + RLS + permissions, `app_rw`), **platform** (`/platform/*`, separate JWT audience, `app_platform`, three tables only).

---

## 2. Remaining Human Decisions

### A. Must be decided before implementation (genuine blockers)

| Decision | Why it matters | Recommended implementation default | Blocks which phase |
| --- | --- | --- | --- |
| `customer_name_required` default | Hard-requiring a name on QR orders loses orders at the table (architecture's own red flag); it's also part of the `POST /p/:qrToken/orders` request contract | **Off by default**, tenant-configurable toggle in `tenant_settings.customer_name_required` | Phase 5 (order schema), Phase 12 (public ordering) — blocks freezing the public order DTO |
| QR sticker domain (`app.<domain>`) | Baked into printed QR codes; changing it after printing is expensive/impossible | No technical default exists — needs a real domain decision | Phase 3 (Tables & QR) — blocks Gate 4 exit and any real QR sticker printing |
| Thermal printer model + connection (USB/Bluetooth/LAN) | Decides whether browser printing (the locked V1 approach) is viable as-is, and what CSS/paper width to target | No default possible — physical hardware fact | Phase 13 (Printing) — blocks the Gate-13 acceptance test |
| Render Postgres tier / staging budget | Architecture requires PITR-capable Postgres (Standard or above) from day one once any real bill exists; free/starter tier is explicitly called out as unacceptable | **Render Postgres Standard**, provisioned before any staging tenant is seeded | Phase 1 / Gate 1 exit |
| Cashier discount cap (`billing.max_discount_bp`) | Controls how much a cashier can discount without manager approval | Architecture default is 5000 bp (50%), which is unusually high — owner should confirm the real number, not inherit the placeholder | Phase 7 (Billing) — blocks Gate 8 exit |
| Customer-name retention window | Architecture defaults to 90 days then nulls via cron; this is a policy/compliance call, not just an engineering default | 90 days unless the owner specifies otherwise | Phase 11 (Audit hardening, nightly cron) |

### B. Already has a usable default — does not block

| Decision | Stated default | Why it's safe to proceed |
| --- | --- | --- |
| Mandatory UPI UTR | `payments.upi_reference_required = true`, tenant-overridable | Anti-fraud control the architecture explicitly recommends; safe to ship as-is |
| In-progress order edit permission | `orders.update.in_progress` limited to manager/owner by default | Cashier grant is a later permission-table row change, not a schema change |
| Query layer | Plain `pg` with a thin typed repository layer | This task's own operating constraints ("raw SQL through `pg`, Kysely only if explicitly approved") already resolve ADR-004 |
| Tenant timezone | `Asia/Kolkata` default, stored per tenant | Correct for all currently known tenants; per-tenant column already supports change later |
| Global `user` + tenant-select login step | Already fully specified: `POST /auth/select-tenant` exists in the API catalog | Not actually an open decision — it's built into the locked design |
| `orders.bill_id` as the structural live-bill link + composite tenant FKs | Already the locked design (section 20 of the architecture) | Not a product decision at all — implementation detail already fixed |
| Full-settlement-only payments in V1 | Already the locked design (`payments.allow_partial` default false, hidden) | Not open — implementing partial payment is explicitly future scope |

### C. Deferred until after V1 — do not reopen

Second-outlet / multi-location `organisation` modeling; payment gateway integration and webhooks; refund workflow and `PAID → VOID`; GST/tax lines; WhatsApp channel and delivery pricing; pay-first checkout; item-level discounts and coupon codes; kitchen printers (ESC/POS); inventory; customer accounts and loyalty; SSE/WebSocket upgrade; subscription billing of the tenant itself.

---

## 3. Repository / Monorepo Structure

```text
/
├── apps/
│   ├── web/                        # React + Vite + TS SPA
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── public/         # /t/*, /o/* — QR + order-status flow
│   │   │   │   └── staff/          # /app/* — auth-gated back office
│   │   │   ├── features/           # one folder per domain: orders/, billing/, menu/, ...
│   │   │   ├── components/ui/      # shadcn/ui primitives, design tokens
│   │   │   ├── lib/                # api client, query client, cart reducer, auth context
│   │   │   └── main.tsx
│   │   ├── public/                 # static assets, _headers, _redirects (Cloudflare Pages)
│   │   └── vite.config.ts
│   │
│   └── api/                        # NestJS modular monolith
│       ├── src/
│       │   ├── modules/
│       │   │   ├── tenancy/
│       │   │   ├── identity/
│       │   │   ├── tables/
│       │   │   ├── menu/
│       │   │   ├── orders/
│       │   │   ├── billing/
│       │   │   ├── payments/
│       │   │   ├── kitchen/
│       │   │   ├── expenses/
│       │   │   ├── reporting/
│       │   │   ├── audit/
│       │   │   ├── public/
│       │   │   ├── platform/
│       │   │   └── storage/
│       │   ├── common/
│       │   │   ├── db/              # pg.Pool, withTenantTx(), TransactionContext
│       │   │   ├── guards/          # AuthGuard, TenantGuard, PermissionGuard, PublicQrGuard, PlatformGuard
│       │   │   ├── events/          # in-process EventEmitter wrapper, domain event types
│       │   │   ├── errors/          # error envelope, typed exceptions (409/422 codes)
│       │   │   └── config/          # Zod-validated env config
│       │   ├── jobs/                 # nightly.ts, token cleanup, invariant check
│       │   └── main.ts
│       └── test/                     # integration + API + concurrency suites
│
├── packages/
│   └── contracts/                  # Zod schemas + inferred TS types, shared front/back
│       └── src/{orders,bills,payments,menu,...}.ts
│
├── db/
│   ├── migrations/                 # Flyway V__/R__ files (see section 5)
│   └── seed/                       # two-tenant dev/test fixture, permission catalog seed
│
├── infra/
│   ├── render/                     # render service config notes (no Docker)
│   ├── cloudflare/                 # rate-limit rule docs, CSP/_headers reference
│   └── README.md
│
├── scripts/                        # db-init.sql (role creation), migrate.sh, restore-rehearsal.sh
├── tools/                          # vendored Flyway binary/wrapper if needed
├── docs/                           # the architecture doc, ADRs, this blueprint
└── .github/workflows/ (or equivalent CI)
```

| Directory | Responsibility | Must NOT contain | Dependency direction |
| --- | --- | --- | --- |
| `apps/web` | UI, routing, client state, forms | Business rule enforcement (server is authoritative), direct DB access | depends on `packages/contracts`; never depended on by `apps/api` |
| `apps/api` | All business logic, transactions, RLS-scoped data access | UI concerns, direct Flyway invocation from app code (migrations run out-of-band) | depends on `packages/contracts`; never depends on `apps/web` |
| `packages/contracts` | Zod request/response schemas, shared types, error codes | Runtime framework code, DB clients | depends on nothing in this repo |
| `db/migrations` | Schema, RLS policies, grants, triggers, data seed migrations | Business logic, application queries | applied only by `app_migrator`; `apps/api` never issues DDL |
| `infra` | Deployment/config documentation and non-secret config templates | Secrets, real env values | none — reference material only |

Module boundary inside `apps/api/src/modules/*` mirrors section 4 exactly: each module owns `controller/`, `service/`, `repository/`, `dto/` (re-exporting `packages/contracts` types), and nothing else.

---

## 4. Backend Module Dependency Graph

```text
tenancy
   ↓
identity
   ↓
tables      menu (+ storage)
   ↓            ↓
        orders
          ↓
        billing
          ↓
        payments

kitchen   → reads orders only (no writes back into orders beyond permitted transitions)
expenses  → depends on tenancy only
reporting → read-only across orders, billing, payments, expenses
audit     → write-only consumer of domain events from every module, via interceptor
public    → depends on tables, menu, orders (runs as app_public for token lookup, then app_rw)
platform  → depends on tenancy, identity; runs as app_platform, touches only tenant/tenant_membership/user
storage   → no dependencies; exposes StorageService to menu and (later) expenses
```

**Allowed dependencies:** strictly downward along the graph above. `orders` may import from `tables` and `menu`. `billing` may import from `orders` and `tables`. `payments` may import from `billing` only.

**Forbidden dependencies:** `menu` → `orders` (never — menu must not know an order exists), `orders` → `billing` (billing depends on orders, not the reverse), `payments` → `orders` directly (payments only ever touches a bill), any module → `platform`, any module other than `platform` importing anything from `identity`'s platform-auth pieces, any module obtaining a database connection other than through `common/db`.

**Enforcement:** ESLint `no-restricted-imports` per module folder, checked in CI (fails the build on a forbidden cross-import), mirroring the architecture's stated rule exactly.

**Cross-module writes:** only through the owning module's service, called with an explicit `TransactionContext` passed down from the caller. A module never opens its own transaction when invoked from inside another module's transaction — there is exactly one `BEGIN`/`COMMIT` per request, owned by the top-level use case (e.g. `BillingService.finalize()` owns the transaction that also locks and updates `orders` rows via `OrdersRepository`, passed the same `TransactionContext`).

**Where things live:**
- `TransactionContext` type and `withTenantTx()`: `apps/api/src/common/db/` — a single, module-agnostic primitive every repository takes as its first argument. No module re-implements transaction handling.
- Repositories: one per module, inside that module's own folder, each method signature starts with `(tx: TransactionContext, ...)`. A repository method that doesn't take a `TransactionContext` is a lint violation.
- Domain events (`OrderPlaced`, `BillFinalized`, `PaymentRecorded`): `apps/api/src/common/events/`, emitted strictly *after* commit. Only `audit` subscribes in V1. No business module subscribes to another business module's events to trigger further writes — that would create an implicit, untracked second transaction and is explicitly prohibited.

---

## 5. Database Migration Dependency Plan

Flyway naming: `V<yyyyMMddHHmm>__<snake_description>.sql` for versioned migrations, `R__rls_policies.sql` / `R__grants.sql` / `R__triggers.sql` for repeatables (idempotent, `DROP ... IF EXISTS` then `CREATE`). Every migration is transactional; no `CREATE INDEX CONCURRENTLY` in V1.

**One real ordering problem worth naming explicitly:** `orders.bill_id` references `bill(id)`, but `bill_order` and `bill_line` reference `orders(id)`. That's a forward-reference cycle between `orders` and `bill` — neither table can carry a same-migration FK to the other. This is resolved by creating `orders` **without** `bill_id` first, creating the `bill`/`bill_order`/`bill_line`/`bill_adjustment` tables afterward, and only then running an `ALTER TABLE orders ADD COLUMN bill_id ... REFERENCES bill(id)` migration once `bill` exists. This is a normal staged-migration technique, not an architecture change.

| Stage | Migration | Purpose | Depends on | Key constraints / triggers introduced |
| --- | --- | --- | --- | --- |
| 0 | `V..._extensions` | `CREATE EXTENSION IF NOT EXISTS pg_trgm` (search on `customer_name`, `order_number`) | empty DB | — |
| 0 | `V..._db_roles` | Create `app_migrator` (implicit as migration runner), `app_rw`, `app_public`, `app_platform` roles, `NOBYPASSRLS` on all three | extensions | roles only, no grants yet (grants come after tables exist, stage 12) |
| 1 | `V..._global_identity` | `user`, `refresh_token`, `login_attempt`, `platform_admin` | roles | `UNIQUE lower(email)` on `user`; `UNIQUE token_hash` on `refresh_token`; none carry `tenant_id` |
| 1 | `V..._permission_catalog` | `permission` table (structure only) | global_identity | seeded by a later **data** migration, not here |
| 2 | `V..._tenant_core` | `tenant`, `tenant_settings`, `role`, `role_permission`, `tenant_membership` | permission_catalog | `UNIQUE slug` on `tenant`; PK `tenant_id` on `tenant_settings`; `UNIQUE (tenant_id, name)` on `role`; `UNIQUE (tenant_id, user_id)` on `tenant_membership` |
| 2 | `V..._tenant_counter` | `tenant_counter` | tenant_core | PK `(tenant_id, counter_name)`; no FK needed beyond `tenant_id` |
| 3 | `V..._tables_qr_sessions` | `restaurant_table`, `table_qr_token`, `table_session` | tenant_core | `UNIQUE (tenant_id, name) WHERE deleted_at IS NULL` on table; `UNIQUE token` + `UNIQUE (tenant_id, table_id) WHERE status='ACTIVE'` on QR token; partial unique `(tenant_id, table_id) WHERE status='OPEN' AND table_id IS NOT NULL` on session |
| 4 | `V..._menu_catalog` | `menu_category`, `menu_item`, `menu_variant`, `menu_addon`, `menu_item_addon` | tenant_core | per-table `UNIQUE (tenant_id, ...) WHERE deleted_at IS NULL`; composite tenant FKs throughout |
| 5 | `V..._orders_core` | `orders` **(no `bill_id` yet)**, `order_line`, `order_line_addon`, `order_status_history` | tables_qr_sessions, menu_catalog, tenant_counter | `UNIQUE (tenant_id, idempotency_key)` on orders; CHECK on `status`/`source`/`type`; CHECK `qty > 0` on `order_line`; append-only intent on `order_status_history` (grant enforced in stage 12) |
| 6 | `V..._billing_settings_defaults` | `tenant_settings.round_to_rupee` default `true` (+ backfill), `CHECK (max_discount_bp BETWEEN 0 AND 10000)` | tenant_core | canonical V1 rounding default (architecture section 9) |
| 6 | `V..._billing_core` | `bill`, `bill_order`, `bill_line`, `bill_adjustment`; `UNIQUE (tenant_id, order_id, id)` added to `order_line` | orders_core, tables_qr_sessions | all FKs composite `(tenant_id, ...)` with default NO ACTION (never CASCADE / SET NULL); `bill_number BIGINT`, `UNIQUE (tenant_id, bill_number)`; `bill.idempotency_key`/`fingerprint`, `UNIQUE (tenant_id, idempotency_key)`; CHECK `grand_total = subtotal - discount + tax + service + delivery + rounding` (tax/service/delivery = 0 in V1), `outstanding = grand - paid`, `paid <= grand`, `rounding BETWEEN -49 AND 50`, `status = 'PAID' => outstanding = 0`, `status IN ('FINALIZED','PAID','VOID') => grand > 0`, all money `<= 9007199254740991`; `bill_line.line_kind IN ('ITEM','ADDON')` with `line_total = qty * unit_price`; partial unique on `bill_adjustment` for at most one discount |
| 6 | `V..._orders_bill_link` | `ALTER TABLE orders ADD COLUMN bill_id`, composite FK `(tenant_id, bill_id)` -> `bill`, reverse composite FK `(tenant_id, bill_id, id)` -> `bill_order` | billing_core | closes the `orders` <-> `bill` cycle; the reverse FK enforces `orders.bill_id = X => the order is a member of X`; this is the only place `orders` is altered post-creation in the initial build |
| 7 | `V..._payments` | `payment` (INSERT-only ledger: no `updated_at`; `UPDATE`/`DELETE` revoked from `app_rw`) | billing_core | `UNIQUE (tenant_id, idempotency_key)`; CHECK `amount_paise > 0`; CHECK `method IN ('CASH','UPI_STATIC')`; CHECK `status IN ('PENDING','SUCCEEDED','FAILED','REVERSED')` (all but SUCCEEDED reserved, no V1 code path); no cash-tendered column (change-giving is a UI calculation) |
| 8 | `V..._expenses` | `expense_category`, `expense` | tenant_core | `UNIQUE (tenant_id, name) WHERE deleted_at IS NULL` on category; index `(tenant_id, expense_date)` on expense |
| 9 | `V..._audit_and_support` | `audit_event`, `public_rate_limit`, `image_asset` | tenant_core (audit_event references tenant loosely, no FK to entity — deliberately polymorphic) | index `(tenant_id, entity_type, entity_id)`, `(tenant_id, at)` on audit_event; `public_rate_limit` carries no `tenant_id` |
| 10 | `R__rls_policies` (repeatable) | Enable + **FORCE** RLS on every table with `tenant_id`; one `USING` + one `WITH CHECK` policy each | every table stage above | re-runs on any change; CI coverage query (`pg_tables` ⋈ `pg_policies`) fails the build if any tenant table lacks a policy |
| 11 | `R__grants` (repeatable) | `app_rw`: `SELECT/INSERT/UPDATE/DELETE` on tenant tables, `NOBYPASSRLS`; `app_public`: **`SELECT` on `table_qr_token` only**; `app_platform`: grants on exactly `tenant`, `tenant_membership`, `user`; revoke `UPDATE`/`DELETE` on `order_status_history` and `audit_event` for `app_rw` | rls_policies | this is the migration CI checks against the "exactly one grant" / "exactly three tables" invariants (section 6) |
| 12 | `R__triggers` (repeatable) | `updated_at` generic trigger on every table that has the column; `order_line_addon` → `order_line.line_total_paise` recompute trigger; `order_line` → `order.subtotal_paise` recompute trigger; bill `BEFORE UPDATE` immutability trigger (whitelist `status`, `version`, `voided_*`, `updated_at`, `paid_paise`/`outstanding_paise` when caller is the payment trigger); `payment AFTER INSERT OR UPDATE` trigger recomputing `bill.paid_paise`/`outstanding_paise` | grants | this is where every database-owned invariant in section 6 actually gets its code |
| 13 | `V..._data_seed_permissions` | Insert the full `permission` catalog rows | triggers | data-only migration, never mixed with DDL |
| 13 | `V..._data_seed_system_roles` | Insert `role.is_system = true` rows and default `role_permission` mappings used as the template copied into every new tenant at creation | data_seed_permissions | data-only; per-tenant `role`/`role_permission` rows themselves are created by the `platform` module at tenant provisioning time, not by a migration |

Note: `expense_category`'s nine default rows are seeded **per tenant at creation time** by the `platform` module (`POST /platform/tenants`), not by a migration — there is no global expense-category table to seed.

Migration testing (per the architecture's own CI rule, carried forward unchanged): every push applies all migrations to an empty DB, then runs the RLS coverage query; any tenant table without forced RLS + both policies fails the build, as does any grant of `BYPASSRLS` to `app_rw`.

---

## 6. Database-Owned Invariants

Three tiers, kept distinct throughout: **DB-enforced** (Postgres itself refuses the bad state — CHECK, trigger, unique index, RLS), **transactional service invariant** (correct only because the service wraps the right locks/order in one transaction — Postgres alone can't express it), **UI-only** (a courtesy, not a guarantee — a missing UI check never breaks data integrity).

### Tenant isolation

| Invariant | Tier |
| --- | --- |
| RLS enabled + **forced** on every tenant table, one `USING` + one `WITH CHECK` policy | DB-enforced |
| `app_rw.rolbypassrls = false` (startup check refuses to boot otherwise) | DB-enforced (checked at boot) |
| `app_public` has exactly one grant: `SELECT` on `table_qr_token` | DB-enforced |
| `app_platform` has grants on exactly `tenant`, `tenant_membership`, `user` | DB-enforced |
| Tenant id comes from the JWT/QR token, never trusted from request body | Transactional service invariant (guard-level, not DB) |
| Cross-tenant id lookups return 404, never 403 (no oracle) | Transactional service invariant |

### Orders

| Invariant | Tier |
| --- | --- |
| Order/order-line tenant ownership via composite `(tenant_id, id)` FKs | DB-enforced |
| `order_number` uniqueness and sequencing via `tenant_counter` under `FOR UPDATE` | Transactional service invariant (the lock is service-orchestrated; uniqueness itself is DB-enforced via the counter row) |
| Optimistic `version` bump on every transition, `WHERE status = $expected AND version = $expected` | Transactional service invariant |
| `order_line.line_total_paise` = `unit_price * qty` + add-ons | DB-enforced (trigger, not CHECK — it aggregates a child table) |
| `order.subtotal_paise` = sum of active `order_line.line_total_paise` | DB-enforced (trigger) |
| `order_status_history` append-only | DB-enforced (no UPDATE/DELETE grant for `app_rw`) |
| Edit permission gating by order status (`NEW`/`ACCEPTED` free, `PREPARING`/`READY` needs `orders.update.in_progress` + reason) | Transactional service invariant (guard + service check) |
| "You can't edit a billed order" greyed out in the UI | UI-only (the DB-enforced backstop is `orders.bill_id IS NOT NULL` blocking edit at the service layer) |

### Sessions

| Invariant | Tier |
| --- | --- |
| At most one `OPEN` session per table | DB-enforced (partial unique index `(tenant_id, table_id) WHERE status='OPEN'`) |
| `session_token` uniqueness | DB-enforced (unique constraint) |
| Session auto-closure ("every order COMPLETED/CANCELLED and every bill PAID/VOID/DISCARDED") | Transactional service invariant — not a DB constraint, evaluated in the closing transaction |
| Session close blockers | Transactional service invariant: normal close rejected with 409 if any orders are active (`NEW`, `ACCEPTED`, `PREPARING`, `READY`) or any bills are `DRAFT` or `FINALIZED`. Force-close with mandatory reason bypasses blockers, transitions `DRAFT` bills to `DISCARDED` (with audit), and leaves `FINALIZED` bills payable/voidable. |
| Draft creation locks session `FOR SHARE` | Transactional service invariant: ensures draft creation and session closure serialize cleanly. |
| "Stale session" warning banner after `stale_session_hours` | UI-only |

### Bills

| Invariant | Tier |
| --- | --- |
| `grand_total = subtotal - discount + tax + service + delivery + rounding` | DB-enforced (CHECK) |
| `outstanding = grand_total - paid`, `paid <= grand_total` | DB-enforced (CHECK) |
| Finalized bill's `bill_line`/`bill_adjustment`/`bill_order`/totals immutable; post-finalize only `status`→VOID + `voided_*`/`version` may change through the service, and `paid_paise`/`outstanding_paise`/the FINALIZED→PAID edge only through the payment settlement trigger (`pg_trigger_depth() > 1`) | DB-enforced (`bill_guard` BEFORE trigger: column whitelist per state + legal status edges; `bill_child_guard` requires a DRAFT parent) |
| `bill_number` uniqueness, assigned only at finalize | DB-enforced (unique constraint) |
| An order belongs to at most one live bill | DB-enforced (`orders.bill_id` structural, set/cleared under row lock) |
| `orders.bill_id` and `bill_order` membership agree for FINALIZED/PAID bills | Transactional service invariant (both written/cleared in the same finalize/void transaction — no single DB constraint spans both tables) |
| Lock ordering at finalize: bill row first, then covered orders `FOR UPDATE` in ascending id order | Transactional service invariant |
| `PAID → VOID` does not exist | DB-enforced (CHECK on the status transition set / no code path emits it) |
| Snapshot immutability vs DB-owned settlement fields | DB-enforced (`BEFORE UPDATE` trigger on `bill` using `pg_trigger_depth()`): financial snapshot columns (`subtotal`, `discount`, `tax`, `service`, `delivery`, `rounding`, `grand_total`, `bill_number`) and line items are strictly immutable once `FINALIZED`. Settlement fields (`paid_paise`, `outstanding_paise`, and transition to `PAID`) are updated exclusively by the payment settlement trigger at trigger depth > 1. |
| `bill_number` uniqueness, assigned only at finalize | DB-enforced (unique constraint); monotonically increasing per tenant, gaps acceptable. |
| Active bill ownership via `orders.bill_id` | DB-enforced (`orders.bill_id` structural, set at finalize under ascending row locks, cleared to `NULL` at void). |
| `bill_order` historical retention | DB-enforced: `bill_order` records covered orders for drafts and finalized bills. Rows are retained forever even if the bill is voided (historical audit record). An order's active billing status is determined exclusively by `orders.bill_id IS NOT NULL`. |
| Reverse FK & composite provenance | DB-enforced: `orders` has tenant-scoped FK to `bill(tenant_id, id)` and reverse FK reference to `bill_order`. `order_line` has `UNIQUE (tenant_id, order_id, id)` for composite provenance FKs from `bill_line`. |
| Finalize lock ordering & version guard | Transactional service invariant: locks bill `FOR UPDATE`, verifies `expectedVersion`, locks covered orders in ascending ID order `FOR UPDATE`, re-derives active order lines, verifies `expectedGrandTotalPaise`, allocates monotonic `bill_number`, and sets `orders.bill_id` while incrementing `orders.version`. |
| `PAID → VOID` does not exist | DB-enforced (CHECK / trigger rejects status changes from `PAID`). |
| Bill creation idempotency | Enforced on `(tenant_id, idempotency_key)` using `canonicalJsonFingerprint` with sorted order IDs. |

### Payments

| Invariant | Tier |
| --- | --- |
| `amount_paise > 0` | DB-enforced (CHECK) |
| Idempotency on `(tenant_id, idempotency_key)` | DB-enforced (unique constraint) |
| `PENDING → SUCCEEDED/FAILED`, `SUCCEEDED → REVERSED` (reserved, unused) as the only legal status set | DB-enforced (CHECK) |
| `paid_paise`/`outstanding_paise` recomputed from `SUM(SUCCEEDED)`, bill flips to PAID when outstanding = 0 | DB-enforced (`AFTER INSERT ON payment` trigger only: locks the bill `FOR NO KEY UPDATE`, then sums in a SEPARATE statement — see architecture ADR-029) |
| No overpayment (`paid + amount <= grand_total`); full-settlement-only unless `payments.allow_partial` | Transactional service invariant (service asserts before insert, inside the bill row lock) |
| Nightly drift re-check of `paid = SUM(succeeded)` across all bills | DB-enforced check, service-triggered on a schedule (belt-and-braces, not relied on for correctness) |
| Idempotency on `(tenant_id, idempotency_key)` | DB-enforced (unique constraint) with canonical request fingerprint. |
| INSERT-only payment records | DB-enforced: `UPDATE` and `DELETE` revoked from `app_rw`. No `updated_at` column. |
| V1 status is `SUCCEEDED` | In V1, recorded payments are inserted directly as `SUCCEEDED`. `PENDING`/`FAILED` are reserved in enum for future dynamic gateways. |
| DB-owned settlement trigger | DB-enforced (`AFTER INSERT ON payment` trigger): row-locks `bill FOR UPDATE`, performs separate `SUM(amount_paise)` over succeeded payments, recomputes `paid_paise` and `outstanding_paise`, and transitions `status = 'PAID'` when outstanding is 0. |
| Full-settlement-only in V1 | Transactional service invariant: `amount_paise == bill.outstanding_paise`. Partial payment (`422 PARTIAL_PAYMENT_NOT_ENABLED`) and overpayment (`422 OVERPAYMENT`) are strictly rejected. |

### Audit

| Invariant | Tier |
| --- | --- |
| `audit_event` append-only | DB-enforced (no UPDATE/DELETE grant) |
| Tenant isolation on audit rows | DB-enforced (RLS, same as any tenant table) |
| Actor context (`actor_kind`, `actor_id`) recorded on every write | Transactional service invariant (an interceptor writes it inside the same transaction as the business mutation — the DB doesn't know an event "should" exist) |

---

## 7. Tenant Context / RLS Implementation Blueprint

```text
Request
 ↓
Auth/Public/Platform Guard   (resolves identity → attaches tenant_id / actor_kind to the request)
 ↓
Controller → Service.someUseCase()
 ↓
withTenantTx(ctx, async (tx) => { ... })
 ↓
BEGIN
 ↓
SET LOCAL app.tenant_id = $1
SET LOCAL app.user_id   = $2   -- or NULL for customer/system
SET LOCAL app.actor_kind = $3  -- 'staff' | 'customer' | 'system' | 'platform'
 ↓
Repository SQL (parameterised, via `tx`, never a raw pool client)
 ↓
COMMIT (success) / ROLLBACK (any thrown error)
 ↓
Domain events emitted (post-commit only)
```

### Tenant JWT request
`AuthGuard` verifies the JWT, extracts `tid`/`sub`/`mid`/`rv`; `TenantGuard` attaches `tenantId` to the request; `PermissionGuard` checks the route's `@RequirePermission`. The service then calls `withTenantTx({tenantId, userId, actorKind: 'staff'}, fn)`.

### Public QR request
`PublicQrGuard` resolves the token as `app_public` — **a single `SELECT` on `table_qr_token` joined to `tenant.status`, nothing else**. Once resolved, the guard attaches `tenantId` and the request proceeds exactly like a tenant request, but with `actorKind: 'customer'` and `userId: null`, and the connection used for everything past that point is `app_rw`, not `app_public`. `app_public` never appears again in the request lifecycle.

### Platform request
`PlatformGuard` verifies the `aud: 'platform'` JWT against `platform_admin`. `withTenantTx` is not used at all for pure platform operations that touch no tenant table (e.g. creating a tenant) — those run under `app_platform` with `actorKind: 'platform'` and `SET LOCAL app.actor_kind = 'platform'`, scoped to `tenant`/`tenant_membership`/`user` only. Platform code has no code path that can select `app_rw`.

### Background job (per-tenant, e.g. image processing follow-up)
A job is a function that loops known tenant ids and calls `withTenantTx({tenantId, actorKind: 'system'}, fn)` once per tenant — never one query spanning tenants.

### Nightly job (cross-tenant, e.g. rollup, invariant check, token pruning)
Same pattern: iterate tenants, one `withTenantTx` per tenant, as `app_rw` with `actorKind: 'system'`. The one exception is the RLS/grant coverage check itself, which runs as a superuser/CI role outside the app entirely (it's a schema audit, not a business query).

### Connection pooling safety
`pg.Pool`, `max = 10` per API instance. Because context is `SET LOCAL` (transaction-scoped, not session-scoped), a connection released back to the pool carries nothing forward — the next transaction on that connection starts with no tenant context until it sets its own. `DISCARD ALL` runs on release only when a client is returned in an error state, as belt-and-braces. If PgBouncer is ever added, transaction pooling mode stays safe for exactly this reason — but it is not part of V1.

### Prohibited patterns (build-time/code-review gate, not just documentation)
- `pool.query(...)` directly against any tenant table — every tenant-table query must go through a `TransactionContext`.
- Session-level `SET app.tenant_id` (vs. `SET LOCAL`) — leaks across pooled connections.
- Any application connection string using a superuser or table-owner role.
- Reading `tenant_id` from the request body/query string and trusting it for anything security-relevant — it comes only from the guard-resolved JWT/token.
- Any repository method signature that doesn't take a `TransactionContext` as its first parameter — this is the lint-enforced tell that a query might be running outside `withTenantTx`.

---

## 8. Authentication and Authorization Implementation Plan

| Component | Responsibility | Tables touched |
| --- | --- | --- |
| Password hashing | Argon2id (64 MB memory, 3 iterations, parallelism 1) at signup/invite and password change | `user.password_hash` |
| Login | `POST /auth/login`: verify credentials, return `{accessToken, memberships[]}`; if exactly one membership, token is tenant-bound immediately | `user`, `tenant_membership`, `login_attempt` |
| Membership selection | `POST /auth/select-tenant`: exchange a multi-membership token for a tenant-bound access token | `tenant_membership` |
| Access JWT | HS256, 15 min TTL, claims `sub`/`tid`/`mid`/`rv`/`aud:'tenant'`/`jti` | — |
| Refresh token | 256-bit random, stored **hashed**, rotated on every use, family-revoked on reuse detection | `refresh_token` |
| Refresh rotation | `POST /auth/refresh`: cookie-authenticated, `SameSite=Strict`, rotates and returns a new access token | `refresh_token` |
| Token family revocation | Reuse of an already-rotated token revokes the whole family (theft signal) | `refresh_token` |
| Logout | `POST /auth/logout`: revokes the current refresh family | `refresh_token` |
| Password change | `POST /auth/change-password`: bumps `user.security_version`, invalidating outstanding access tokens within ~60 s | `user` |
| Security version | `rv` claim checked against a 60 s in-memory cache of `security_version`; role changes bump it too | `user`, `tenant_membership` |
| Role changes | `PATCH /users/:membershipId`: audited, bumps the target's `security_version` | `tenant_membership`, `role`, `audit_event` |
| Permission guard | Loads the membership's permission set (cached 60 s, invalidated by `rv`), rejects 403 on missing `@RequirePermission` | `role_permission`, `permission` |
| Platform authentication | Separate credential class, `aud: 'platform'`, separate `platform_admin` table | `platform_admin` |
| Public token authentication | QR token → tenant context; order token → single-order read scope, dies when the session closes | `table_qr_token`, `table_session` |

Guard responsibilities, kept strictly separate (the architecture's "guards check permission; RLS checks tenant; services check business rules" rule, carried forward unchanged):

```text
AuthGuard       — is this JWT valid, and who is the caller?
TenantGuard     — bind tenantId onto the request from the verified claim
PermissionGuard — does this membership hold the required permission string?
PublicQrGuard   — resolve a QR/order token to a tenant + session, nothing else
PlatformGuard   — verify the platform-audience JWT, attach actorKind='platform'
```

No guard ever queries a tenant-operational table (`orders`, `bill`, `payment`, etc.) — that's the service layer's job, always inside `withTenantTx`.

---

## 9. Domain Implementation Sequence

Fifteen phases, each gated by the prerequisite phase's exit criteria (see section 20 for the formal gates). Ordering follows the module dependency graph (section 4) and the migration dependency plan (section 5); no phase implements a module whose DB tables or upstream module aren't already built.

| Phase | Implements | Prerequisites | DB deps | Backend modules | Key endpoints | Frontend screens | Required tests | Completion criteria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Foundation | Repo skeleton, CI, `withTenantTx`, config | — | roles, `db-init.sql` | `common/db`, `common/config` | `GET /health` | — | CI green on empty scaffold | Sprint 1 exit (section 21) |
| 2. Tenancy + Identity | Login, tenant, membership, roles, RBAC | Phase 1 | global_identity, tenant_core migrations | `tenancy`, `identity` | `/auth/*`, `GET /tenant`, `/users/*`, `/roles`, `/permissions` | login, tenant-select | unit (permission resolution), RLS coverage suite, API auth matrix | A second tenant can be created and a user can log into each with correct isolation |
| 3. Tables + QR + Sessions | Table CRUD, QR issue/revoke, session open/close | Phase 2 | tables_qr_sessions migration | `tables` | `/tables/*`, `/sessions/:id`, `/sessions/:id/close` | tables list, QR sheet | integration (partial-unique-index race), concurrency (two scans, one session) | QR domain decision (2A) resolved; one open session per table enforced under load |
| 4. Menu | Category/item/variant/add-on CRUD, availability, images | Phase 2 | menu_catalog migration | `menu`, `storage` | `/menu/*` | menu editor | unit (`priceLine`), upload validation tests | Public menu JSON assembles correctly with an `ETag` |
| 5. Orders | Counter + order state machine, edit, cancel | Phases 3, 4 | orders_core migration | `orders` | `/orders/*` (excl. public) | counter POS, order detail | unit (state machine), integration (line-total trigger), concurrency (version conflicts) | `customer_name_required` decision (2A) resolved; full order lifecycle testable from the counter |
| 6. Kitchen | KDS read model, kitchen transitions | Phase 5 | — (reads orders) | `kitchen` | `/kitchen/orders?since=` | KDS screen (flag-gated) | API (permission matrix for kitchen role) | Cursor polling returns only changed rows |
| 7. Billing | Draft/finalize/void, discounts | Phase 5 | billing_core + orders_bill_link migrations | `billing` | `/bills/*` | bill drawer | integration (finalize lock ordering, immutability trigger), concurrency (double finalize) | Discount cap decision (2A) confirmed; `orders.bill_id`/`bill_order` consistency test passes |
| 8. Payments (delivered inside Gate 8, see ADR-030) | Cash/UPI record, settlement | Phase 7 | payments migration | `payments` | `/payments`, `GET /bills/:id/payments` | payment dialog | integration (payment trigger, overpayment rejection), concurrency (duplicate payment) | UTR-required default (2B) shipped as-is; `paid = SUM(succeeded)` holds under concurrent test |
| 9. Expenses | CRUD, categories | Phase 2 | expenses migration | `expenses` | `/expenses/*`, `/expense-categories/*` | expenses screen | unit + API | Nine default categories seeded at tenant creation |
| 10. Dashboard / Reporting | Aggregates, breakdowns | Phases 7, 8, 9 | — (reads only) | `reporting` | `/dashboard/*` | dashboard | API (metric correctness against seed fixture) | Business-day boundary (04:00 default) correctly attributes a 1 a.m. bill |
| 11. Audit hardening | Append-only audit on every mutating path, retention cron | Phases 2–10 | audit_and_support migration | `audit` | `/audit` | audit log view | integration (append-only grant test) | Retention-window decision (2A) confirmed; nightly cron nulls customer names correctly |
| 12. Public QR ordering | Customer-facing QR flow end to end | Phases 3–8 | — (reuses existing tables) | `public` | `/p/*` | `/t/*`, `/o/*` | concurrency (20 simultaneous QR orders on one table), isolation (Tenant B token 404s) | `app_public` boundary test passes (section 6); customer-name decision (2A) live in the DTO |
| 13. Printing | Bill + kitchen slip browser print, 58/80 mm and A4 CSS | Phase 12 (bill), Phase 6 (kitchen slip) | — | (frontend only) | `GET /tables/:id/qr.svg`, print routes | print views | manual acceptance test (real printer) | Printer decision (2A) resolved; Gate 13 acceptance test passed on real hardware |
| 14. Frontend integration | Full staff app wiring, error/loading/empty states, 409 recovery | Phases 2–13 | — | — | — | all `/app/*` screens | Vitest/RTL feature tests | Every screen has loading/empty/error states and recovers from 409 by refetching |
| 15. E2E + concurrency + deployment | Full journeys, load assumptions checked, staging cutover | Phase 14 | — | — | — | — | Playwright 13 journeys + isolation script; concurrency suite nightly | Gate 14 (production readiness) met |

---

## 10. API Implementation Blueprint

Organized by the phase that first requires each endpoint (no new endpoints invented beyond what the architecture already catalogs). Every list is cursor-paginated; every mutating financial/order-creating endpoint requires `idempotencyKey`; every update to a versioned entity requires `expectedVersion`.

| Phase | Endpoint | Idempotency? | Version? | Transaction | Key invariant checked | Notable errors |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | `POST /auth/login` | — | — | single-row read + `login_attempt` insert | brute-force lockout | 401, 423 (locked) |
| 2 | `POST /auth/refresh` | — | — | rotate + insert | family reuse → revoke all | 401 |
| 2 | `POST /users/invite` | — | — | insert/find `user` + `tenant_membership` | email uniqueness (global `user`) | 409 |
| 3 | `POST /tables/:id/qr/regenerate` | — | — | revoke old + insert new token | one `ACTIVE` token per table | — |
| 3 | `POST /sessions/:id/close` | — | — | lock session | no unpaid bills unless forced | 409 |
| 5 | `POST /orders` | ✔ | — (create) | lock counter row, insert order + lines | `priceLine()` re-validated availability | 422 `ITEM_UNAVAILABLE` |
| 5 | `PATCH /orders/:id/lines` | — | ✔ | `SELECT ... FOR UPDATE` on order | billed orders are rejected BEFORE the version check; edit gating by status | 422 `ORDER_ALREADY_BILLED` (billed), 409 (version) |
| 5 | `POST /orders/:id/transition` | — | ✔ | conditional `UPDATE ... WHERE status=$from AND version=$v` | state machine legality | 409 |
| 7 | `POST /bills` | ✔ | — (create) | insert draft + copy lines | orders belong to the same session | — |
| 7 | `POST /bills/:id/finalize` | — | ✔ | lock bill, lock orders (ascending id), re-copy lines | `expectedGrandTotalPaise` match; `orders.bill_id`/`bill_order` written together | 409 (totals moved), 422 `ORDER_ALREADY_BILLED` |
| 7 | `POST /bills/:id/void` | — | ✔ | lock bill, lock orders (ascending id), clear `orders.bill_id` (`bill_order` history is RETAINED) | FINALIZED only, reason required, refused if any money paid | 409 `BILL_NOT_VOIDABLE` / `BILL_HAS_PAYMENTS` |
| 8 | `POST /payments` | ✔ | ✔ (`expectedBillVersion`) | lock bill | `amount = outstanding` unless partial enabled | 422 `OVERPAYMENT`/`PARTIAL_PAYMENT_NOT_ENABLED`, 409 (not FINALIZED) |
| 9 | `POST /expenses` | ✔ | — | insert | `expense_date` in tenant timezone | — |
| 12 | `POST /p/:qrToken/orders` | ✔ | — | `app_public` resolves token, then `app_rw` inside `withTenantTx` | rate limit + `max_open_orders_per_table` | 404 (closed session/revoked token), 422 |
| 12 | `GET /p/orders/:orderToken` | — | — | `app_rw`, read-only | 404 once session `CLOSED` | 404 |

---

## 11. Order → Bill → Payment Transaction Boundaries

Lock ordering is explicit wherever more than one row is locked, matching the architecture's `READ COMMITTED` + explicit-lock strategy (no `SERIALIZABLE`, to avoid Friday-rush retries).

**1. Create QR order**
```text
BEGIN (as app_rw, actorKind=customer, after app_public token resolve)
  LOCK   tenant_counter row FOR UPDATE (order_number)
  VALIDATE  priceLine() re-checks availability; rate-limit + max_open_orders_per_table
  MUTATE INSERT orders, order_line, order_line_addon
  AUDIT  audit_event('order.created')
COMMIT
DOMAIN EVENT  OrderPlaced
```

**2. Create counter order** — identical to (1) minus the public-token step and rate limit; `actorKind='staff'`.

**3. Edit order**
```text
BEGIN
  LOCK   orders row FOR UPDATE (expectedVersion checked)
  VALIDATE  status permits edit; orders.bill_id IS NULL
  MUTATE line add/update/remove; recompute subtotal (trigger); version += 1
  AUDIT  audit_event('order.edited', before/after diff)
COMMIT
```

**4. Transition order**
```text
BEGIN
  MUTATE conditional UPDATE ... WHERE status=$from AND version=$v  -- zero rows = re-read + 409
  MUTATE INSERT order_status_history
  AUDIT  (order_status_history row itself is the audit trail)
COMMIT
DOMAIN EVENT  OrderStatusChanged
```

**5. Cancel order**
```text
BEGIN
  LOCK   orders row FOR UPDATE
  VALIDATE  not already billed (unless void-first flow), reason present
  MUTATE status → CANCELLED, cancelled_at/by
  AUDIT  order_status_history + audit_event
COMMIT
```

**6. Create bill**
```text
BEGIN
  LOOKUP idempotency key (inside the transaction): replay or IDEMPOTENT_MISMATCH
  LOCK   table_session row FOR SHARE            -- serializes against session close (FOR UPDATE)
  VALIDATE  session OPEN; every order in that session, not CANCELLED, bill_id IS NULL
  MUTATE INSERT bill (DRAFT), bill_order rows, bill_line snapshot (ITEM + ADDON rows), computeBillTotals()
  -- a DRAFT does NOT set orders.bill_id: several drafts per session (even over one order) are allowed
  AUDIT  audit_event('created')
COMMIT
```

**7. Finalize bill** (the highest-stakes transaction in the system)
```text
BEGIN
  LOCK   bill row FOR UPDATE
  LOCK   each covered order FOR UPDATE, in ascending order-id order  -- deterministic lock order
  VALIDATE  each order.bill_id IS NULL, not CANCELLED, same session
  READ   active order lines/add-ons ONLY NOW (after the parent locks; READ COMMITTED gives every statement a fresh snapshot)
  MUTATE re-copy the bill_line snapshot (draft may be stale); recompute subtotal -> discount -> rounding
  VALIDATE  resulting grand_total == expectedGrandTotalPaise and grand_total > 0
  MUTATE assign bill_number (tenant_counter, late), set orders.bill_id + orders.version for every covered order
  MUTATE bill.status = FINALIZED  -- bill_guard re-checks lines/discount sums and that every member order points back
  AUDIT  audit_event('finalized')
COMMIT
DOMAIN EVENT  BillFinalized
```

**8. Void bill**
```text
BEGIN
  LOCK   bill row FOR UPDATE
  VALIDATE  status == FINALIZED (never PAID), reason non-empty, paid_paise == 0
  LOCK   covered orders FOR UPDATE in ascending id order
  MUTATE clear orders.bill_id (+ orders.version) for every covered order
  MUTATE bill.status → VOID  -- bill_order rows are RETAINED (historical association); the snapshot is untouched
  AUDIT  audit_event('voided', reason)
COMMIT
```

**9. Record payment**
```text
BEGIN
  LOCK   bill row FOR UPDATE
  LOOKUP idempotency key INSIDE the transaction, after the lock: same fingerprint => replay, different => IDEMPOTENT_MISMATCH
  VALIDATE  status == FINALIZED; expectedBillVersion; method; UPI reference; amount == outstanding
  MUTATE INSERT payment (status=SUCCEEDED, INSERT-only)
  TRIGGER payment_settle (AFTER INSERT): lock bill FOR NO KEY UPDATE, SUM(SUCCEEDED) in a separate statement, update paid/outstanding, status → PAID when outstanding == 0
  AUDIT  audit_event('recorded')
COMMIT
DOMAIN EVENT  PaymentRecorded
```

**10. Close session**
```text
BEGIN
  LOCK   table_session row FOR UPDATE
  VALIDATE  every order COMPLETED/CANCELLED and every bill DISCARDED/PAID/VOID (DRAFT and FINALIZED block), else 409 SESSION_HAS_OPEN_ORDERS / SESSION_HAS_DRAFT_BILLS / SESSION_HAS_UNPAID_BILLS
  FORCE  (reason present) bypasses the blockers, DISCARDs the session's DRAFT bills (audited); FINALIZED bills stay payable/voidable
  MUTATE status → CLOSED, closed_at
  AUDIT  audit_event('session.closed')
COMMIT
```

**11. Regenerate QR**
```text
BEGIN
  LOCK   table_qr_token row(s) FOR UPDATE (old ACTIVE token for this table, if any)
  MUTATE old.status → REVOKED; INSERT new ACTIVE token
  AUDIT  audit_event('qr.regenerated')
COMMIT
```

**12. Change menu availability**
```text
BEGIN
  MUTATE UPDATE menu_item/menu_variant SET is_available=$v  -- last-write-wins, no version check by design
  AUDIT  audit_event('menu.availability_changed')
COMMIT
```

---

## 12. Idempotency Blueprint

- **Scope:** every create endpoint for `orders`, `bill` finalize, `payments`, `expenses`.
- **Fingerprint:** SHA-256 of the canonical (key-sorted) JSON request body, stored alongside the key as `idempotency_fingerprint`.
- **Constraint:** `UNIQUE (tenant_id, idempotency_key)` on the target table (`orders`, `payment`, `expense`); `POST /bills` carries its own `idempotency_key`/`idempotency_fingerprint` on `bill`; finalize, void, discard and discount are version-guarded rather than key-guarded (a retry after success is a 409 `VERSION_CONFLICT` carrying the current bill). Payment idempotency is looked up INSIDE the transaction after the bill lock (a same-key retry after success would otherwise fail the FINALIZED check before reaching the insert).
- **Same key + same fingerprint:** treated as a replay — return the original row with `200` and `Idempotent-Replay: true`, no new row created.
- **Same key + different fingerprint:** `409 IDEMPOTENT_MISMATCH` — the client is reusing a key for a different logical request, which is always a client bug.
- **Duplicate network request (client retried before seeing a response):** the unique constraint on `(tenant_id, idempotency_key)` makes the second insert either fail-and-be-caught-as-a-replay-lookup or naturally collide; the service always does an upsert-shaped "insert, on unique violation re-read and compare fingerprint" flow rather than a separate pre-check-then-insert (which would itself race).
- **Network failure after commit (client never saw the response):** the retry with the same key finds the already-committed row and replays it — this is the entire point of the pattern, no special-casing needed.
- **Concurrent duplicate requests (two tabs, same key, same instant):** the unique constraint is the arbiter — one insert wins, the other hits a unique violation, re-reads, and returns the winner's row as a replay.
- **No separate idempotency table is introduced.** The key/fingerprint pair lives directly on the entity being created, exactly as the architecture specifies — this keeps the "did it happen" question answerable with one query on the entity itself.

---

## 13. Frontend Implementation Blueprint

Two route trees, sharing only the design system. Order below matches Phase 5/6/7/8/12/13 dependencies.

### Public (`/t/*`, `/o/*`)

| Feature | Route | API hooks | Query keys | Mutations | Invalidation | Permissions | States |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QR context | `/t/:qrToken` | `useQrContext(token)` | `['public','context',token]` | — | — | none (public token) | loading skeleton; 404 → "closed restaurant" page |
| Menu | `/t/:qrToken/menu` | `useMenu(token)` | `['public','menu',token]` | — | on `ETag` change (polled) | none | loading, empty (no items), error (retry) |
| Cart | client-only | — | — | local reducer + `localStorage` | — | none | — |
| Place order | `/t/:qrToken/checkout` | `usePlaceOrder()` | — | `POST /p/:qrToken/orders` | invalidate session-orders query | none | 422 item-unavailable → inline cart fix; 409 duplicate → replay silently |
| Order status | `/o/:orderToken` | `useOrderStatus(token)` (polling) | `['public','order',token]` | — | poll every 3–5 s | none | loading, 404 → "session closed" |
| Session orders | `/o/session/:sessionToken` | `useSessionOrders(token)` (polling) | `['public','session',token]` | — | poll | none | empty (no orders yet) |

### Staff (`/app/*`)

| Feature | Route | API hooks | Query keys | Mutations | Invalidation | Permissions | States |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Login / tenant select | `/app/login` | `useLogin()`, `useSelectTenant()` | — | `POST /auth/login`, `/auth/select-tenant` | — | none | error (bad credentials), locked (423) |
| Dashboard | `/app` | `useDashboardSummary()` | `['dashboard','summary',period]` | — | manual refresh | `dashboard.read` | loading, empty (no data yet) |
| Counter / Tables | `/app/tables` | `useTablesLive()` (polling) | `['tables','live']` | — | poll 3–5 s | `sessions.read` | loading, empty (no tables) |
| Orders | `/app/orders` | `useOrders(filters)` | `['orders',filters]` | `create/edit/transition/cancel` | invalidate `orders` + `tables/live` | `orders.*` | 409 → refetch + toast |
| Menu editor | `/app/menu` | `useMenu()` | `['menu']` | CRUD + availability | invalidate `menu` + public menu `ETag` bump | `menu.*` | last-write-wins, no 409 by design |
| Kitchen (KDS) | `/app/kitchen` | `useKitchenOrders()` (polling) | `['kitchen','orders']` | transition | poll | `kitchen.read`, `orders.transition.kitchen` | flag-gated (hidden entirely if `kitchen_display_enabled=false`) |
| Billing | `/app/tables/:id/bill` | `useBillDraft()`, `useFinalizeBill()` | `['bills',billId]` | draft/discount/finalize/void | invalidate `bills`, `orders`, `tables/live` | `bills.*` | 409 (totals moved) → re-fetch draft, re-confirm |
| Payments | `/app/tables/:id/bill/pay` | `useRecordPayment()` | — | `POST /payments` | invalidate `bills`, `dashboard` | `payments.record` | 422 overpay inline; 409 not-finalized → back to bill |
| Expenses | `/app/expenses` | `useExpenses(filters)` | `['expenses',filters]` | CRUD | invalidate `expenses`, `dashboard` | `expenses.*` | empty (no expenses this range) |
| Users | `/app/settings/users` | `useUsers()`, `useInvite()` | `['users']` | invite/role-change/revoke-sessions | invalidate `users` | `users.*` | — |
| Settings | `/app/settings` | `useSettings()` | `['settings']` | `PATCH /settings` | invalidate `settings`, public menu cache header | `settings.*` (payments keys need `settings.payments.manage`) | — |
| Printing | `/app/print/bill/:id`, `/app/print/kitchen-slip/:id` | reuses bill/order queries | — | — | — | inherits bill/order permission | print-only layout, no navigation chrome |
| Audit | `/app/audit` | `useAuditLog(filters)` | `['audit',filters]` | — | — | `audit.read` (owner/manager) | empty |

Every list screen implements loading (skeleton), empty (explicit "no X yet" state, not a blank table), error (retry action), and 409 recovery (silent refetch + a toast naming what changed, per the architecture's "every screen recovers from a 409 by refetching" rule) — this is a Phase 14 completion gate, not optional polish.

---

## 14. State Management Plan

| State kind | Mechanism | Notes |
| --- | --- | --- |
| Server state | TanStack Query | Source of truth for anything that came from the API; polling intervals per screen as listed in section 13 |
| Local UI state | `useState`/`useReducer` | Modal open/closed, selected tab, form-in-progress fields before submit |
| Forms | React Hook Form + `zodResolver` | Schemas imported from `packages/contracts`, so frontend validation and backend validation are the same schema |
| Auth | Small React context; **access token held in memory only**, never `localStorage`/`sessionStorage` | Refresh token lives in the `HttpOnly` cookie the browser manages automatically |
| Cart | Local reducer + `localStorage` | Public/customer-side only; cart contents are not sensitive, but never store the resulting order/session tokens here beyond what the public flow already treats as bearer credentials |
| Cross-tab | `BroadcastChannel` | Used to sync cart/auth-logout across tabs; not a substitute for server state |

**Never placed in global client state:** access tokens, refresh tokens, any tenant financial totals treated as authoritative (always re-derived from a query, never held stale in a store "for convenience"), permission-check results cached longer than the TanStack Query cache itself (avoids a UI showing a control the server would now reject).

---

## 15. Testing Implementation Matrix

| Test area | Tool | Scenarios | Must pass before |
| --- | --- | --- | --- |
| Backend unit | Jest | `computeBillTotals`, state-machine transition table, Zod schemas, money rounding, permission resolution, idempotency fingerprinting | every push |
| Frontend unit | Vitest + RTL | cart reducer, money formatting, `<Can>` permission component, form validation, counter-panel logic with mocked hooks | every push |
| DB integration | Jest + real Postgres, Flyway applied fresh, `app_rw` role | every repository/service method; RLS assertion suite; bill immutability + payment triggers; every invariant in section 6; unique/partial indexes; deadlock-free lock ordering | every push (~3 min) |
| API | Jest + supertest, real DB | every endpoint's happy path; auth/permission matrix (one test per role per endpoint, table-driven); error envelope shapes; idempotent replay + mismatch; version conflicts; closed-session token 404s | every push |
| Concurrency | Jest, `Promise.all` of real HTTP calls | two-cashier edit; double finalize; two drafts over one order; 20 simultaneous QR orders on one table; duplicate payment; counter contention — assert exactly-one-winner and `paid = SUM(succeeded)` afterward | nightly + pre-release; **Gate exit for Phases 5, 7, 8, 12** |
| E2E | Playwright, staging, three browser contexts (owner desktop, cashier desktop, customer mobile viewport) | the 13 brief journeys as one linear script, plus an isolation script logging in as Tenant B and asserting every Tenant A id returns 404 | pre-release; **Gate 13/14** |
| Migration | CI job | apply all migrations to empty DB; apply latest N to a staging snapshot; RLS coverage query | every push |
| Printing acceptance | Manual | real thermal printer on the real counter PC, 58 mm and 80 mm, bill and kitchen slip, via browser print | once, before lock — **Gate 13** |

### Mandatory invariant-specific tests

- **Tenant isolation:** seed `tenantA`/`tenantB` with mirrored data; for every repository method, a call under tenant A returns zero tenant-B rows and cannot mutate them.
- **Financial invariants:** for every bill in the concurrency suite, assert `grand_total = subtotal - discount + tax + service + delivery + rounding` and `paid = SUM(succeeded)`, `outstanding = grand_total - paid`.
- **Billing uniqueness:** an order cannot end up on two live bills — drive two concurrent finalize attempts over the same order and assert exactly one succeeds with 422 `ORDER_ALREADY_BILLED` on the loser.
- **Idempotency:** identical key+fingerprint retried N times produces exactly one row; same key + different fingerprint always 409s.
- **Concurrency:** every "exactly one winner" scenario above is asserted, not just exercised.
- **Public token isolation:** a customer's order/session token cannot read another table's/session's/order's data — 404, not partial data.

---

## 16. Observability and Operational Blueprint

| Requirement | V1 (must-have) | Later |
| --- | --- | --- |
| Structured logs | `pino` JSON to stdout; every line has `requestId`, `tenantId`, `userId`/`actorKind`, `route`, `durationMs`, `status`; public tokens never logged | log aggregation service beyond Render's own search |
| Business event logs | `info`-level `event: 'order.placed' | 'bill.finalized' | 'payment.recorded' | 'tenant.probe' | 'auth.login_failed'` with entity id | structured event pipeline |
| Errors | Sentry (free tier), `requestId` tag, tenant id as context, PII scrubbed | paid tier / alert routing |
| Health | `GET /health` (liveness), `GET /health/db` (`SELECT 1`, migrations current, `app_rw` cannot bypass RLS) — external ping every minute | — |
| Metrics | `/metrics` Prometheus text (`prom-client`): request duration histogram, DB pool usage, 409/422 counters, orders/tenant, slow-query count (`>500ms`) | Grafana Cloud scraping |
| Production watchlist | p95 on `POST /p/:token/orders`, `POST /bills/:id/finalize`, `GET /dashboard/summary`; DB pool saturation; 5xx rate; refresh-token reuse events; `tenant_probe` warnings; nightly invariant-check result; disk/connection count; daily backup success | dashboards/alerting on the above |

---

## 17. Deployment Implementation Sequence

```text
Cloudflare (DNS · WAF · rate limit · Pages)
 ↓
Pages   →  static SPA build, `_headers`/`_redirects`, SPA fallback to index.html
 ↓
Render API  →  Node 22, `npm ci && npm run build`, `npm run migrate && node dist/main`, health check `/health`
 ↓
Render PostgreSQL Standard  →  daily backups + PITR, two roles created by scripts/db-init.sql before first migration
 ↓
Cloudflare R2  →  private bucket, pre-signed PUT for uploads
 ↓
Render Cron  →  nightly.js (token/rate-limit pruning, customer-name nulling, invariant check)
```

- **Environment variables:** see section 18.
- **Database roles:** `app_migrator` (DDL, runs migrations only), `app_rw` (API runtime), `app_public` (QR token lookup only), `app_platform` (platform routes only) — all four provisioned by `scripts/db-init.sql` before the first migration runs.
- **Migration credentials:** `MIGRATION_DATABASE_URL` (as `app_migrator`) is distinct from `DATABASE_URL` (as `app_rw`) — the running API process never has DDL rights.
- **API credentials:** `DATABASE_URL` only; no direct DB access from the SPA.
- **CORS:** allow-list of exact origins from env; `https://app.<domain>` only in staging/production, `http://localhost:5173` in development.
- **CSP:** `default-src 'self'; img-src 'self' <r2 host>; script-src 'self'`; `X-Frame-Options: DENY` except `/print/*` (`self`, for iframe printing).
- **Secrets:** Render environment groups hold `JWT_SECRET`, both DB URLs, R2 keys, Sentry DSN; `.env` is git-ignored; startup fails fast on any missing required var (Zod-validated config).
- **Health checks:** Render uses `/health` for liveness; an external ping (UptimeRobot) hits `/health/db` every minute.
- **Backup:** Render daily snapshots + weekly `pg_dump` to R2 via cron; **restore rehearsed once before launch** (a hard Gate 14 requirement, not optional).
- **Deployment order:** migrations run as part of the Render build step (`npm run migrate`), gated by a Flyway-held advisory lock, *before* `node dist/main` starts — so the new schema is always in place before new code serves traffic.
- **Migration order:** forward-only, expand/contract for any change to a live table (add nullable column → deploy dual-write code → backfill in batches → add constraint → drop old column in a later release); renames are never done in place.
- **Rollback strategy:** `git revert` + Render "rollback to previous deploy." Because migrations are forward-only, a rollback means deploying previous code that still tolerates the newer schema — this is why expand/contract is mandatory discipline, not a nice-to-have.

No Docker anywhere in this sequence, consistent with the lock.

---

## 18. Environment Configuration

`.env.example` (no secret values — structure and ownership only):

```text
# APP
NODE_ENV=                      # development | staging | production — all environments
PORT=                          # API listen port — development/staging (Render sets its own in prod)
APP_BASE_URL=                  # public app.<domain> — all environments, consumed by email/print links

# DATABASE
DATABASE_URL=                  # app_rw connection string — all environments, consumed by API runtime
MIGRATION_DATABASE_URL=        # app_migrator connection string — all environments, consumed by Flyway only
DB_POOL_MAX=                   # default 10 — all environments, consumed by common/db

# JWT
JWT_SECRET=                    # 256-bit secret, HS256 — all environments, consumed by identity module
JWT_ACCESS_TTL=                # default 15m — all environments
REFRESH_TOKEN_TTL_DAYS=        # default 30 — all environments

# CORS
CORS_ALLOWED_ORIGINS=          # comma-separated exact origins — staging/production, consumed by main.ts

# CLOUDFLARE
CF_RATE_LIMIT_NOTES=           # documentation pointer only, not a runtime var — staging/production

# R2
R2_ACCOUNT_ID=                 # required staging/production, consumed by storage module
R2_ACCESS_KEY_ID=              # required staging/production
R2_SECRET_ACCESS_KEY=          # required staging/production
R2_BUCKET=                     # required staging/production

# SENTRY
SENTRY_DSN_API=                # optional development, required staging/production
SENTRY_DSN_WEB=                # optional development, required staging/production

# SECURITY
ARGON2_MEMORY_KB=              # default 65536 — all environments, consumed by identity module
LOGIN_LOCKOUT_THRESHOLD=       # default 5 — all environments

# FEATURES
FEATURE_KITCHEN_DISPLAY=       # tenant-level default toggle — all environments (per-tenant override lives in tenant_settings, not env)
```

---

## 19. Definition of Done

### Architecture
- [ ] Module boundaries enforced by CI lint (no forbidden cross-imports)
- [ ] No ORM, no Redis, no MongoDB, no Docker anywhere in the codebase or deploy config

### Database
- [ ] All migrations apply cleanly to an empty DB
- [ ] RLS coverage test passes for every tenant table
- [ ] Every invariant in section 6 has a passing automated test
- [ ] All triggers (`updated_at`, line-total, subtotal, bill immutability, payment settlement) pass their dedicated tests
- [ ] Composite tenant FKs verified on every child table
- [ ] Role/grant boundaries verified: `app_public` = one grant, `app_platform` = three tables, `app_rw` cannot bypass RLS

### Backend
- [ ] Full API contract (section 10/12 of the architecture) implemented
- [ ] Idempotency implemented on every required endpoint (section 12)
- [ ] Concurrency rules implemented and passing the concurrency suite
- [ ] Audit events written on every mutating path

### Frontend
- [ ] All required routes exist for both route trees
- [ ] Permission guards applied per screen
- [ ] Loading/empty/error states on every list/detail screen
- [ ] 409 recovery (refetch + toast) implemented uniformly
- [ ] Polling intervals match section 13

### Business
- [ ] QR order, counter order, kitchen, bill, payment, expense, dashboard, audit, and printing all function end to end against a seeded tenant

### Security
- [ ] Authentication and authorization flows fully implemented (section 8)
- [ ] RLS verified under the isolation test suite
- [ ] Token handling matches section 8 exactly (in-memory access token, HttpOnly refresh cookie)
- [ ] Rate limiting active on `/auth/*` and `/p/*`
- [ ] Upload validation (magic bytes, re-encode, metadata strip) active

### Operational
- [ ] Staging deployed on Render Standard Postgres with PITR
- [ ] Backups running; restore rehearsed at least once
- [ ] Health checks live and externally monitored
- [ ] Monitoring/watchlist from section 16 in place

Screens existing is explicitly **not** sufficient — every box above must be checked.

---

## 20. Implementation Gates

```text
GATE 0  — Architecture accepted
GATE 1  — Repository foundation
GATE 2  — Database + RLS
GATE 3  — Identity
GATE 4  — Tables + QR
GATE 5  — Menu
GATE 6  — Orders
GATE 7  — Kitchen
GATE 8  — Billing
GATE 9  — Payments
GATE 10 — Expenses + Dashboard
GATE 11 — Public ordering
GATE 12 — Printing
GATE 13 — Full integration
GATE 14 — Production readiness
```

| Gate | Entry criteria | Work | Tests | Exit criteria | Must NOT proceed until |
| --- | --- | --- | --- | --- | --- |
| 0 | This blueprint reviewed | — | — | Architecture + blueprint both signed off | anything is built |
| 1 | Gate 0 passed | Repo skeleton, CI, `packages/contracts` scaffold, `common/db` | CI green on an empty scaffold | Sprint 1 deliverables (section 21) all present | Render Standard Postgres provisioned (decision 2A) |
| 2 | Gate 1 passed | All migrations through `R__triggers`, roles + grants + RLS | RLS coverage + trigger tests green | Every invariant in section 6 has a passing test | any application module writes to the DB |
| 3 | Gate 2 passed | `tenancy`, `identity` modules, `/auth/*` | API auth matrix, RLS isolation suite (two tenants) | Two tenants provably isolated end to end | any tenant-operational module (orders/billing/payments) is built |
| 4 | Gate 3 passed | `tables` module | Partial-unique-index race test | QR domain decision (2A) resolved; one-session-per-table holds under concurrency | menu/orders depend on this |
| 5 | Gate 4 passed | `menu`, `storage` modules | Upload validation, `priceLine()` unit tests | Public menu JSON assembles with correct `ETag` | orders module depends on this |
| 6 | Gates 4–5 passed | `orders` module | State machine, line-total trigger, version-conflict tests | Customer-name decision (2A) resolved; full counter order lifecycle works | billing depends on this |
| 7 | Gate 6 passed | `kitchen` module | Permission matrix for kitchen role | Polling returns only changed rows | — (parallel to billing) |
| 8 | Gate 6 passed | `billing` module | Finalize lock-ordering + immutability trigger tests, double-finalize concurrency test | Discount cap decision (2A) confirmed; `orders.bill_id`/`bill_order` consistency test passes | payments depends on this |
| 9 | _(merged into Gate 8)_ | — | Payments are delivered with billing in Gate 8 (ADR-030); Gates 10-14 keep their numbers so existing references stay valid | — | — |
| 10 | Gates 8–9 passed | `expenses`, `reporting` modules | Metric-correctness API tests against seed fixture | Business-day boundary correctly attributes bills/payments/expenses | — |
| 8 | Gate 6 passed | `billing` & `payments` modules | Finalize lock-ordering + immutability trigger tests, payment settlement trigger, double-finalize & duplicate-payment concurrency tests | Discount cap confirmed; `round_to_rupee=true`; `orders.bill_id`/`bill_order` consistency test passes; `paid=SUM(succeeded)` holds under concurrency | dashboard depends on this |
| 10 | Gate 8 passed | `expenses`, `reporting` modules | Metric-correctness API tests against seed fixture | Business-day boundary correctly attributes bills/payments/expenses | — |
| 11 | Gates 2–10 passed | `public` module | Isolation test (Tenant B token → 404), concurrency (20 simultaneous QR orders) | Retention-window decision (2A) confirmed; `app_public` boundary test passes | printing is finalized against real bill output |
| 12 | Gate 11 passed | Print CSS/routes | Manual acceptance test on real hardware | Printer decision (2A) resolved; acceptance test passed on real hardware | frontend integration is declared complete |
| 13 | Gates 3–12 passed | Full `/app/*` wiring, error/empty/loading states | Playwright 13 journeys + isolation script | Every screen meets the frontend Definition-of-Done checklist | staging cutover |
| 14 | Gate 13 passed | Staging → production cutover prep | Load-assumption check (section 17's performance numbers are *targets*, verify or revise), backup restore rehearsal | Definition of Done (section 19) fully checked | go-live |

---

## 21. First Implementation Sprint

Sprint 1 does **not** implement any business feature. At the end of Sprint 1, the following must exist:

1. Monorepo structure exactly as in section 3, with `apps/web`, `apps/api`, `packages/contracts` as empty-but-buildable workspaces.
2. Package management/workspaces configured (npm/yarn/pnpm workspaces — pick one, document the choice in `docs/`).
3. TypeScript configuration shared via a base `tsconfig` referenced by both apps.
4. Linting configured, including the `no-restricted-imports` module-boundary rule from section 4 (even with only stub modules, the rule should be wired and testable).
5. Formatting (Prettier or equivalent) configured and enforced in CI.
6. Test infrastructure: Jest for `apps/api`, Vitest for `apps/web`, both running (even on trivial placeholder tests) in CI.
7. NestJS shell: `apps/api` boots, serves `GET /health`, has the module folder skeletons from section 3 (empty modules, no business logic).
8. React/Vite shell: `apps/web` boots, has the two route-tree folders from section 13 (empty, no screens yet).
9. `packages/contracts` workspace exists with at least one real Zod schema (e.g. the error envelope shape) consumed by both apps, proving the wiring works.
10. PostgreSQL local development setup documented and scripted (`scripts/db-init.sql` creating the four roles).
11. Flyway wired and running against local Postgres (even with zero real migrations yet — the runner and naming convention are proven).
12. Database roles (`app_migrator`, `app_rw`, `app_public`, `app_platform`) created by `db-init.sql` and verified with a startup check that the API refuses to boot if `app_rw.rolbypassrls = true`.
13. First migrations: `V..._extensions`, `V..._db_roles` (from section 5, stage 0) — nothing past that; no tenant tables yet.
14. RLS foundation: the `R__rls_policies` and `R__grants` repeatable migration files exist and run (even though there's nothing to protect yet), and the CI RLS-coverage-query job is wired and green (vacuously, since there are no tenant tables).
15. `withTenantTx()` implemented in `common/db`, with a unit/integration test proving `SET LOCAL` context does not leak across a pooled connection.
16. CI pipeline runs all of the above (lint, both test suites, migration-apply-to-empty-DB, RLS coverage) on every push.

Sprint 1 exit = Gate 1 exit (section 20). No `tenant`, `user`, or any business table exists yet — that begins in Gate 2 / Phase 2.

---

## 22. Genuine Blockers

**No architecture-level blockers were found.**

One implementation-technique detail is worth flagging explicitly so it isn't mistaken for a design gap: `orders.bill_id` and `bill_order`/`bill_line` form a mutual reference between `orders` and `bill`. This is resolved with a standard staged migration (create `orders` without `bill_id`, create `bill` and its child tables, then `ALTER TABLE orders ADD COLUMN bill_id`) — see section 5, stage 6. This is a migration-sequencing technique, not a contradiction in the architecture, and requires no architectural correction.

---

## Architecture Change Log

> **Gate 8 reconciliation (billing + payments).** No change of architecture; the following text was corrected to match the locked Gate 8 plan: `bill_order` is retained on void (`orders.bill_id` is the only current link); PAID is set by the settlement trigger, which is `AFTER INSERT` only, locks the bill and then sums in a separate statement; payments are INSERT-only; draft creation locks the session `FOR SHARE`, session close is blocked by open orders and DRAFT/FINALIZED bills; `round_to_rupee` defaults to `true`; `PATCH /orders/:id/lines` returns 422 `ORDER_ALREADY_BILLED`; Gate 8 and Gate 9 are merged (payments ship with billing). Recorded as ADR-028 to ADR-031 in the architecture document.
