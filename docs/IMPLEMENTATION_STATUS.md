# Implementation Status

Current Gate: Gate 6 (Orders) + Self-Service Onboarding
Status: COMPLETE — live-verified against a real PostgreSQL 17 instance.
Gate 7 (Kitchen) remains explicitly blocked pending onboarding review.

This file is updated at the end of every gate. See the Implementation
Blueprint (section 20, "Implementation Gates") for the full gate list and
exit criteria.

**Gate numbering note:** earlier work in this repo's history used
session-local numbering ("Gate 1" = repo foundation + DB/RLS bundled,
"Gate 2" = tenancy + identity). This file now uses the blueprint's own
canonical numbers (section 20): Gate 1 = repository foundation, Gate 2 =
database + RLS, **Gate 3 = tenancy + identity** (previously called "Gate 2"
in this repo), **Gate 4 = tables + QR** (previously would have been called
"Gate 3"). Nothing was skipped or redone — only the label changed.

## Gate 3 (Identity) — now fully DB-verified

Everything below was previously blocked on local PostgreSQL superuser
credentials, which have since been provided. All of it has now actually
been run, not just built:

- [x] `scripts/db-init.sql` runs cleanly against a fresh superuser bootstrap
- [x] All 12 Gate 1-3 migrations apply cleanly via Flyway
- [x] RLS coverage check passes (0 violations) — every tenant table has
      forced RLS + both policies
- [x] `app_rw`/`app_public`/`app_platform` all verified `rolbypassrls = false`
- [x] Backend DB integration suite (`test/db/`): **21/21 pass** —
      `with-tenant-tx`, `rls-tenant-membership`, `gate2-vertical-journey`
      (kept its original filename; covers the full identity vertical slice)
- [x] Backend non-DB tests: 54/54 pass
- [x] Frontend tests: 22/22 pass

Three real bugs were found and fixed only by executing against a live
database (none were catchable by static review):

1. **`app_platform` was missing a grant on `audit_event`** —
   `POST /platform/tenants` returned 500 on every call in real use, because
   `PlatformService.provisionTenant()` writes an audit row in the same
   transaction and that table was never added to app_platform's grant
   list. Fixed in `R__grants.sql` (SELECT + INSERT only, matching the
   append-only pattern already used for `app_rw`).
2. **`rls-tenant-membership.integration.spec.ts` seeded through the wrong
   role** — it connected as `app_rw` (SELECT-only on `tenant`) while
   claiming `actorKind: 'platform'`; RLS restricts which rows an already-
   granted operation can touch, it doesn't grant the operation itself.
   Fixed the test to seed through a real `app_platform` pool.
3. **A test asserted the wrong "unset" representation for a custom GUC** —
   `with-tenant-tx.integration.spec.ts` expected `current_setting('app.tenant_id',
true)` to return `NULL` after a committed `SET LOCAL`, but Postgres
   returns `''` once a custom GUC name has been referenced at all in the
   session. This is already safe by design (`R__rls_policies.sql` casts via
   `nullif(current_setting(...), '')::uuid`), so the test assertion was
   corrected to match reality rather than the security logic being changed.

Also discovered and fixed along the way: two other repeatable migrations
(`R__grants.sql`, `R__triggers.sql`) only reapply when Flyway sees their
own checksum change — adding a new tenant table or `updated_at` column in
a later migration silently leaves it without grants/triggers unless the
repeatable file itself is also touched. Both files now carry an explicit
comment warning future gates about this.

## Gate 4 (Tables + QR) — built and live-verified this session

Scope per blueprint row 372 / architecture section 11: table CRUD, QR
issue/revoke (via a single idempotent "regenerate" endpoint), the
printable QR sheet, the cashier live-floor view, and session read/close.
Session **open** has no HTTP endpoint yet — architecture: a session opens
implicitly on a table's first order (Gates 6/11), so it's exposed here only
as `TableSessionRepository.openForTable()`, exercised directly by tests and
ready for `orders`/`public` to call in later gates.

### Exit criteria

- [x] `tables` module built (`restaurant_table`, `table_qr_token`,
      `table_session` migration + repositories/services/controllers)
- [x] Partial-unique-index race test passes: 20 concurrent session-open
      attempts on the same table → exactly 1 winner, 19 unique-violation
      rejections, verified against a real Postgres instance
      (`table-session-race.integration.spec.ts`)
- [x] Full HTTP vertical journey passes against a real API + real Postgres
      (`gate4-tables-qr-sessions.integration.spec.ts`): create/patch/
      delete a table, duplicate-name 409, QR regenerate (issue + reissue
      revokes the old token), QR SVG rendering, QR sheet PDF rendering,
      live floor view, soft-delete blocked by an open session, session
      close + already-closed 409, tenant isolation (cross-tenant 404s)
- [x] RLS coverage check still passes after adding 3 new tenant tables (0
      violations, 9 tenant tables scanned)
- [x] `app_public`'s grant remains exactly one: `SELECT` on
      `table_qr_token` — verified live via `information_schema`
- [ ] **QR sticker domain (`app.<domain>`) — deferred, not a build
      blocker.** No technical default exists per blueprint section 2A; the
      user explicitly chose to defer this decision. `APP_BASE_URL` (already
      in `env.schema.ts` since Gate 3) is used as the QR target's base URL,
      falling back to `http://localhost:5173` in development. This is the
      one open item before Gate 4 can be marked fully exited per the
      blueprint's own gate table (row 790) — everything else is done.

### What Gate 4 deliberately does NOT do yet

- No `PublicQrGuard` / `app_public`-driven token resolution / `/p/*`
  routes. `GET /tables/:id/qr.svg` and `GET /tables/qr-sheet.pdf` are
  **staff-facing** (`tables.read`, JWT-authenticated), for viewing/printing
  the sticker — not the customer scan flow, which is Gate 11.
- `GET /tables/live`'s `openOrderCount`/`unpaidBillTotalPaise` are always
  `0` — factually correct today (no `orders`/`bill` tables exist until
  Gates 6/8), wired to real values once those modules land.
- `POST /sessions/:id/close`'s "no unpaid bills" check is unconditional for
  now (vacuously true — nothing to block on yet); the force-close-with-
  reason path is fully wired (`force_closed`, audit `reason`) so Gate 8
  only needs to add the actual blocking check.
- `GET /sessions/:id`'s response has no `orders`/`bills` arrays yet — added
  once those modules exist, per a note directly on the contract type.
- No `/app/counter` (order-taking floor view, `orders.create`) — that's
  Gate 6. Gate 4's frontend is `/app/tables` (CRUD) and `/app/tables/qr`
  (QR sheet), matching architecture section 13's route table exactly.

### New dependencies

- `qrcode` / `@types/qrcode` — SVG/PNG QR rendering (pure JS, no native
  deps).
- `pdfkit` / `@types/pdfkit` — the printable QR sheet PDF (pure JS, no
  native deps; consistent with the "no containers" constraint).

### New endpoints

| Endpoint                                | Auth                 | Notes                                                                           |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `GET /api/v1/tables`                    | T `[tables.read]`    | list, includes `hasActiveQr` per table                                          |
| `POST /api/v1/tables`                   | T `[tables.manage]`  | audited: `restaurant_table.created`; 409 on duplicate name                      |
| `PATCH /api/v1/tables/:id`              | T `[tables.manage]`  | audited: `restaurant_table.updated`                                             |
| `DELETE /api/v1/tables/:id`             | T `[tables.manage]`  | soft delete; audited: `restaurant_table.deleted`; 409 if an OPEN session exists |
| `POST /api/v1/tables/:id/qr/regenerate` | T `[tables.manage]`  | revoke-old + insert-new in one transaction; audited: `qr.regenerated`           |
| `GET /api/v1/tables/:id/qr.svg`         | T `[tables.read]`    | staff-facing asset, not the public scan target                                  |
| `GET /api/v1/tables/qr-sheet.pdf`       | T `[tables.read]`    | one A4 PDF, every table with an active QR                                       |
| `GET /api/v1/tables/live`               | T `[sessions.read]`  | cashier floor view                                                              |
| `GET /api/v1/sessions/:id`              | T `[sessions.read]`  |                                                                                 |
| `POST /api/v1/sessions/:id/close`       | T `[sessions.close]` | audited: `table_session.session.closed`                                         |

### Migrations added

`V202609181000__tables_qr_sessions` (`restaurant_table`, `table_qr_token`,
`table_session`, all three unique-index invariants from architecture
section 11), plus updates to `R__rls_policies` (bespoke `table_qr_token`
policy — see below) and `R__grants`/`R__triggers` (checksum-bump comments
only, dynamic loops needed no logic changes).

### Discovered inconsistency, resolved with judgment (reported here)

**`table_qr_token`'s RLS policy vs. `app_public`'s pre-tenant-context
read.** The generic "RLS scoped by `app.tenant_id`" policy every other
tenant table gets would always deny `app_public`'s read, because token
resolution is what _discovers_ the tenant — no `app.tenant_id` can be set
yet at that point (architecture ADR-023). **Resolution:** `table_qr_token`
gets a bespoke policy: `USING (tenant-scoped match OR current_user =
'app_public')`, `WITH CHECK` stays tenant-only. This is safe specifically
because `app_public` holds exactly one grant in the whole database — this
policy only changes which _rows_ it can see, not what _operations_ it can
perform; the grant is still the real boundary. `current_user` reflects the
actual authenticated database role (nothing in this codebase ever runs
`SET ROLE`), which is strictly harder to spoof than the
`current_setting('app.*')` checks the `tenant`/`tenant_membership`
policies rely on. (No code actually queries as `app_public` yet — that's
Gate 11 — but the grant is created automatically the moment
`table_qr_token` exists, so the policy needed to be correct now rather than
leaving a known-broken half-state for Gate 11 to discover.)

### Test status (this gate)

- Backend DB integration (Jest, `test/db/`): **38/38 pass** (21 from Gate 3
  - 17 new: 15 in `gate4-tables-qr-sessions.integration.spec.ts`, 1 in
    `table-session-race.integration.spec.ts`, plus the RLS/grants fixes
    above)
- Backend non-DB (Jest): 54/54 pass (unchanged from Gate 3 — no non-DB
  tests were added this gate; all new logic is exercised live)
- Frontend (Vitest + RTL): 27/27 pass (22 from Gate 3 + 5 new in
  `tables-page.test.tsx`)
- Lint + build: contracts, api, web all clean

### Frontend routes added

`/app/tables` (list, create form, inline activate/deactivate/delete,
QR/session/status badges, live-polled session state) and `/app/tables/qr`
(QR sheet: per-table SVG preview + regenerate, "Download PDF sheet"
button). Both fetch their binary assets (SVG/PDF) via an authenticated
`fetch` + `Blob` + object-URL, never a bare `<img src>`/`<a href>` — those
can't carry the in-memory bearer token, and the endpoints require it.

---

## Gate 5 (Menu Catalog) — built and live-verified

Scope per blueprint row 373 / architecture section 10: `menu_category`,
`menu_item`, `menu_variant`, `menu_addon`, `menu_item_addon` — full CRUD,
availability toggles (last-write-wins, no version check, exactly as
architecture specifies), reorder, and price-change audit. `storage`
(image upload) is deliberately deferred — see below.

### Exit criteria

- [x] `menu` module built (5-table migration + repositories/services/
      controller)
- [x] Fresh-database migration verified from scratch: `db-init.sql` →
      Flyway (10 versioned + 3 repeatable) → RLS coverage (0 violations,
      14 tenant tables) → full DB integration suite, **8 suites / 70 tests,
      all green**, including every Gate 2-4 test unchanged
- [x] Upgrade-path migration verified on the existing Gate 4 database
      (`rewardbite_dev`) — same clean apply, same 0 RLS violations
- [x] Real concurrent-write tests (not sequential) for every
      concurrency-sensitive invariant: duplicate category name (10
      concurrent inserts → 1 winner), duplicate item name within a
      category, duplicate variant name within an item — in each case the
      partial unique index is the arbiter, not an app-level pre-check
- [x] 9 named tenant-isolation attacks (A-I from the task brief) executed
      live against the real HTTP API + real Postgres — see below
- [x] `app_public` has zero grants on any menu table (menu catalog is
      authenticated-only in Gate 5; public menu resolution is Gate 11)

### What Gate 5 deliberately does NOT do yet

- **Image upload** (`POST /menu/items/:id/image/upload-url` /
  `.../image/confirm`, the `image_asset` table) — no R2/S3 credentials
  exist in this environment (`R2_ACCOUNT_ID` etc. are still unset),
  the same class of deferral as Gate 4's real QR domain. `menu_item
.image_key` exists (schema-complete) but nothing writes to it. This is
  a genuine blocker classification (real cloud credentials, a product/
  infra decision), not a scope cut for convenience.
- **No `/p/*` public menu endpoint.** The architecture describes the
  public menu JSON + `ETag` assembly at the same point as Gate 5's own
  exit criteria, but the task brief explicitly excludes Public Ordering.
  `MenuSnapshotService.buildActiveTree()` / `.computeETag()` implement
  that assembly logic internally (unit-testable, ready for Gate 11 to
  call) without exposing any HTTP route or touching `app_public` grants.
- No `POST /menu/items/:id/image/*` — see above.
- No `/app/counter` order-taking integration — `priceLine()`-shaped
  consumption of the catalog is Gate 6 (Orders).

### Judgment calls (implementation details, documented per the task's own

### ambiguity-classification instructions — none reopen the architecture)

1. **`veg_flag` values.** Architecture says only "nullable enum, useful in
   India." Implemented as TEXT + CHECK (not a Postgres enum, per the
   established convention) with values `VEG`/`NON_VEG`/`EGG`.
2. **Category soft-delete blocked while it still has non-deleted items.**
   Not explicitly stated by the architecture; mirrors Gate 4's own
   precedent ("soft-delete blocked while an OPEN session exists").
3. **Item soft-delete cascades to its variants** (compositional
   ownership — a variant has no independent meaning once its item is
   gone) but does **not** cascade to `menu_item_addon` rows (addons are
   reusable/many-to-many; stale links are simply filtered out, never
   hard-deleted).
4. **Item↔addon assignment has no dedicated REST resource.** The
   architecture's endpoint catalog (section 11) lists exactly four
   independently-CRUDable menu resources — categories/items/variants/
   addons — not a fifth "item-addon" one. Implemented as a field
   (`addons: [{addonId, maxQty}]`) on the item's own create/patch body,
   full-replace semantics.
5. **`base_price_paise IS NOT NULL OR EXISTS variant`** — architecture
   states this is "enforced in service," not a DB CHECK. Since variants
   are created via a separate endpoint _after_ the item exists, the
   invariant cannot be checked at item-creation time without inventing a
   bundled create-with-variants endpoint the architecture doesn't
   describe. **Resolution:** item creation/patch never blocks on this;
   the one point actually enforced is deleting the _last_ remaining
   variant of an item whose `basePricePaise` is still null — rejected
   with 422. This is the only point where the invariant could be
   silently violated after the fact.
6. **Audit granularity.** "Price changes audited" (architecture section 10) is satisfied as a subset of a broader, already-established
   convention (every mutating category/item/variant/addon operation is
   audited with before/after — Gate 4's own pattern), rather than a
   narrower price-only special case. `patchItem`/`patchVariant`/
   `patchAddon` additionally select `action: 'price_changed'` instead of
   `'updated'` specifically when the price field actually changed
   (unit-tested).

### New endpoints

| Endpoint                                       | Auth                           | Notes                                          |
| ---------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `GET /api/v1/menu`                             | T `[menu.read]`                | full tree incl. inactive                       |
| `POST /api/v1/menu/categories`                 | T `[menu.manage]`              | audited: `created`                             |
| `PATCH /api/v1/menu/categories/:id`            | T `[menu.manage]`              | audited: `updated`                             |
| `DELETE /api/v1/menu/categories/:id`           | T `[menu.manage]`              | 409 if non-deleted items remain                |
| `POST /api/v1/menu/items`                      | T `[menu.manage]`              | validates category + addon references          |
| `PATCH /api/v1/menu/items/:id`                 | T `[menu.manage]`              | audited: `updated`/`price_changed`             |
| `DELETE /api/v1/menu/items/:id`                | T `[menu.manage]`              | cascades to variants                           |
| `PATCH /api/v1/menu/items/:id/availability`    | T `[menu.availability.update]` | last-write-wins                                |
| `POST /api/v1/menu/variants`                   | T `[menu.manage]`              |                                                |
| `PATCH /api/v1/menu/variants/:id`              | T `[menu.manage]`              | audited: `updated`/`price_changed`             |
| `DELETE /api/v1/menu/variants/:id`             | T `[menu.manage]`              | 422 if last variant + no base price            |
| `PATCH /api/v1/menu/variants/:id/availability` | T `[menu.availability.update]` | last-write-wins                                |
| `POST /api/v1/menu/addons`                     | T `[menu.manage]`              |                                                |
| `PATCH /api/v1/menu/addons/:id`                | T `[menu.manage]`              | audited: `updated`/`price_changed`             |
| `DELETE /api/v1/menu/addons/:id`               | T `[menu.manage]`              |                                                |
| `POST /api/v1/menu/reorder`                    | T `[menu.manage]`              | `{categoryIds[]}` or `{categoryId, itemIds[]}` |

Note: per architecture's own role table, Cashier and Kitchen Staff have
`menu.availability.update` but **not** `menu.read`/`menu.manage` — they
cannot open `/app/menu` at all (it requires `menu.read`). This is the
locked architecture's own definition, unchanged by Gate 5.

### Migrations added

`V202609181500__menu_catalog` (`menu_category`, `menu_item`,
`menu_variant`, `menu_addon`, `menu_item_addon`, every unique/partial-
unique/CHECK constraint from architecture section 10), plus checksum-bump
comments in `R__grants`/`R__rls_policies`/`R__triggers` (no bespoke
policy needed — all five tables use the plain generic tenant policy,
unlike Gate 4's `table_qr_token`).

### Test status (this gate)

- Backend DB integration (Jest, `test/db/`): **30 new tests** across
  three files — `gate5-menu-catalog.integration.spec.ts` (14, full
  vertical journey incl. cascade/blocking rules), `gate5-menu-tenant-
isolation.integration.spec.ts` (9, HTTP-level Attacks A-F and I),
  `menu-rls-attacks.integration.spec.ts` (7, SQL-level Attacks F/G/H plus
  3 real concurrent-write races) — run against both a genuinely fresh
  database and the existing upgraded one
- Backend unit (Jest): **7 new tests** in `menu.service.spec.ts`
  (price-change audit action selection, last-variant guard, addon
  existence validation) — same `withTenantTx`-mocking convention as
  `users.service.spec.ts`
- Contracts (Vitest): **13 new tests** in `menu.test.ts` — schema
  validation, whitespace rejection, mass-assignment stripping proof
- Frontend (Vitest + RTL): **6 new tests** in `menu-page.test.tsx` —
  loading/empty/error/data states, create-category submission,
  availability toggle, mutation-error surfacing
- Lint + build + format: all clean across `contracts`, `api`, `web`

### Tenant-isolation attacks (live, per the task's lettered list)

All executed against the real HTTP API and/or real Postgres, not
simulated:

| Attack                                                                                            | Result                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A: Tenant A reads Tenant B category                                                               | not present in `GET /menu`'s tree                                         |
| B: Tenant A modifies Tenant B category                                                            | 404, unchanged                                                            |
| C: Tenant A deactivates/deletes Tenant B item                                                     | 404, unchanged                                                            |
| D: Tenant A creates item/variant referencing Tenant B category/item, or attaches Tenant B's addon | 404 in every case                                                         |
| E: client-supplied `tenantId` in the request body                                                 | silently stripped by Zod; row created under the authenticated tenant only |
| F: no tenant context                                                                              | 401 (HTTP) / 0 rows (SQL)                                                 |
| G: malformed non-UUID tenant context                                                              | fails closed (Postgres throws, never leaks rows)                          |
| H: `app_rw` `SET row_security = off`                                                              | blocked with an error                                                     |
| I: authenticated user without `menu.manage`/`menu.read` (Kitchen Staff)                           | 403 on every read and mutation attempt                                    |

### Concurrency tests (real concurrent writes, not sequential)

- 10 concurrent `INSERT`s of the same category name → exactly 1 commits,
  9 hit the partial unique index, final count is 1
- Same pattern for a duplicate item name within one category, and a
  duplicate variant name within one item
- Availability toggle is intentionally last-write-wins per architecture
  (no version check) — verified it behaves that way, not "fixed" to add
  locking the architecture doesn't want

### Non-blocking notes

- Jest's intermittent "did not exit one second after the test run"
  warning (pre-existing since Gate 2/3, already classified non-blocking
  in the Gate 4 review) reappeared during this gate's runs too, at the
  same non-deterministic rate. Gate 5 introduces no new database
  connections or pooling logic beyond the established `withTenantTx`
  pattern, so this is not attributed to Gate 5.
- One local-environment quirk encountered while fresh-migration-testing:
  `CREATE DATABASE` occasionally didn't inherit a `public` schema from
  `template1` in earlier sessions on this machine; not reproduced this
  time, not a code defect, worked around by creating the schema manually
  when it occurred.

---

## Gate 6 (Orders) — built and live-verified

Scope per blueprint row 191 / architecture section 8 "Order": the
operational order domain — `orders`, `order_line`, `order_line_addon`,
`order_status_history` — full lifecycle CRUD, the fixed state machine,
price/menu snapshotting, idempotent creation, and edit/cancel/reopen. No
Billing, Payments, Kitchen workflows, Public Ordering, Printing, Expenses,
or Reporting were touched.

### Explicit decisions locked (task-required, recorded here per instruction)

- **Order price snapshot.** `order_line` carries `item_name_snapshot`,
  `variant_name_snapshot`, `unit_price_paise` — copied once at line
  creation, architecture section 8's exact column list, verbatim. Never
  re-read from `menu_item`/`menu_variant` after that point.
- **Variant snapshot.** `variant_name_snapshot` (nullable — absent for a
  base-priced item with no variant) alongside `menu_variant_id` (kept as a
  live FK for potential future cross-referencing, exactly mirroring how
  `order_line` already keeps `menu_item_id` alongside its own name
  snapshot).
- **Addon snapshot.** `order_line_addon(tenant_id, order_line_id, addon_id,
name_snapshot, unit_price_paise, qty)` — no surrogate `id` (architecture's
  own column list for this table omits one, unlike `order_line`), composite
  PK, mirroring `menu_item_addon`'s established junction-table shape.
- **Gate 5 base-price/variant invariant — resolved.** Item creation/patch
  never blocks on "has a price." The one point actually enforced: deleting
  the _last_ remaining variant of an item whose `basePricePaise` is still
  null is rejected (422) — the only place the invariant could be silently
  violated after the fact. (This was already implemented in Gate 5; Gate 6
  consumes it as-is via `MenuSnapshotService.priceLine()` and adds no new
  behavior here.)
- **Gate 5 item↔addon assignment — resolved.** Confirmed as a field on the
  item's own create/patch body (`addons: [{addonId, maxQty}]`,
  full-replace), validated by `MenuSnapshotService.priceLine()` at order
  creation via `menu_item_addon` lookup — an addon not assigned to the
  selected item is rejected with `422 ITEM_UNAVAILABLE`, live-tested
  (Attack H).
- **`orders.bill_id` deferred.** Not created in this gate's migration —
  the blueprint's own staged-migration technique (forward-reference cycle
  between `orders` and `bill`) puts it in Gate 8's `orders_bill_link`
  migration. `reopen()`'s "unbilled" check is consequently vacuous today
  (every order is unbilled, since the column doesn't exist) — documented
  inline in `order-transition.service.ts` with the exact line Gate 8 needs
  to add.
- **Idempotency scope.** `UNIQUE (tenant_id, idempotency_key)` — per
  tenant, matching architecture section 12 ("keys are scoped per tenant
  and, for public endpoints, per QR token") and every other create-endpoint
  convention in this codebase.
- **Cancellation is its own endpoint.** `POST /orders/:id/cancel`
  (`orders.cancel`, mandatory reason) is never reachable through the
  generic `POST /orders/:id/transition` — the architecture's endpoint
  catalog lists them as two separate rows with two separate permissions;
  `orderTransitionTargetSchema` structurally excludes `CANCELLED`.
- **State machine is the architecture's actual mermaid diagram, not the
  task prompt's illustrative example list** — the two differ:
  `NEW --> COMPLETED` and `ACCEPTED --> COMPLETED` ARE valid transitions
  in "no-kitchen" (`SIMPLE`) workflow mode per the locked diagram, contra
  the task prompt's simplified example. The task prompt itself grants
  authority to the architecture where they differ ("Use the architecture
  as the final authority if any transition differs from the examples
  above"), so the real diagram was implemented, not the illustration.
- **`priceLine()` blocks on `is_available`/`deleted_at`, not
  `is_active`.** Architecture ties `is_active` specifically to "hidden
  from [the customer] menu" (Gate 11 concern); Gate 6's `POST /orders` is
  the staff-facing counter, which can still ring up an item hidden from
  the public/QR menu. Judgment call, documented in
  `menu-snapshot.service.ts`.

### Database-owned invariants (task §13's explicit warning, addressed)

`order_line.line_total_paise` and `orders.subtotal_paise`/`line_count` are
**trigger-maintained**, never a same-row CHECK (impossible — they depend
on child `order_line_addon` rows) and never service-computed-then-trusted.
Two triggers, chained: `order_line` `BEFORE INSERT OR UPDATE` recomputes
its own `line_total_paise` from a fresh subquery over its addons;
`order_line_addon` `AFTER INSERT/UPDATE/DELETE` does a "touch" update on
its parent line to re-fire that same trigger (no formula duplicated); a
third, `order_line` `AFTER INSERT/UPDATE/DELETE`, recomputes the parent
`orders.subtotal_paise`/`line_count` by re-summing only `ACTIVE` lines.
All three chain correctly in one transaction — live-verified with an
11-assertion trigger-cascade script during implementation (insert, addon
insert, qty change, addon qty change, addon delete, line removal — each
checked against the actual persisted value, not inferred).

### Order → session resolution

`POST /orders` takes `type` + optional `tableId`, never a `sessionId`
(architecture's own request shape) — the service resolves/opens the
session server-side: `DINE_IN` reuses the table's existing OPEN session or
opens a new one (`TableSessionRepository.openForTable`, built in Gate 4);
`TAKEAWAY` always opens a fresh `table_id = NULL` session (architecture
section 8: "Takeaway ... orders get a session with table_id = NULL" — no
takeaway "session reuse" concept is described anywhere, so each takeaway
order gets its own). `(type='DINE_IN') = (session has table)` is enforced
in the service (architecture section 11, verbatim), rejecting a `tableId`
on `TAKEAWAY` and requiring one on `DINE_IN`.

**Gate 4 defect fixed here, discovered live:** `table_session` never got
a `UNIQUE (tenant_id, id)` composite constraint (every other composite-FK
_target_ table has one). Fixed forward with an `ALTER TABLE` at the top of
this gate's migration — `V202609181000` is already applied and its
checksum locked, so it couldn't be edited in place.

### New permission infrastructure

`POST /orders/:id/transition` needs `orders.transition.front` **or**
`.kitchen` depending on the _target_ status (`ACCEPTED`/`COMPLETED` vs
`PREPARING`/`READY`) — the only endpoint across every gate so far phrased
with "or" in its permission column. No OR-semantics decorator existed, so
`@RequireAnyPermission(...)` was added alongside the existing
`@RequirePermission(...)` (AND semantics), additive and backward-
compatible — `PermissionGuard` now checks both metadata kinds. The guard
enforces the broad "holds at least one" gate; `OrderTransitionService`
enforces the precise per-target permission once it knows which status is
actually being requested.

### `DomainError` — the mechanism `error-code.util.ts` was already waiting for

That file's own Sprint-1 comment said code-specific errors would arrive
"once each domain module starts throwing its own specific DomainError
subclasses ... e.g. ITEM_UNAVAILABLE, ORDER_ALREADY_BILLED." Gate 6 is
that module: `common/errors/domain-error.ts` (`DomainError extends
HttpException`, carries its own `code`) plus a small addition to
`GlobalExceptionFilter` to prefer it over the generic status-derived code.
Existing exception types are unaffected (no regression — confirmed by the
unchanged non-DB suite). Used for `ITEM_UNAVAILABLE` (422),
`IDEMPOTENT_MISMATCH` (409), `INVALID_TRANSITION` (409),
`ORDER_NOT_EDITABLE` (409), `VERSION_CONFLICT` (409, with
`currentStatus`/`currentVersion` in `details`).

### New endpoints

| Endpoint                             | Auth                                                                        | Notes                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/orders`                 | T `[orders.read]`                                                           | filters `status[]`/`type`/`source`/`sessionId`/`from`/`to`/`q`; keyset cursor pagination on `(placed_at DESC, id DESC)` |
| `GET /api/v1/orders/:id`             | T `[orders.read]`                                                           | lines + addon snapshots + status history                                                                                |
| `POST /api/v1/orders`                | T `[orders.create]`                                                         | idempotent; resolves/opens the session; server-priced                                                                   |
| `PATCH /api/v1/orders/:id/lines`     | T `[orders.update]`, or `.update.in_progress` + reason when PREPARING/READY | add/update/remove, `expectedVersion`                                                                                    |
| `POST /api/v1/orders/:id/transition` | T `[orders.transition.front OR .kitchen]`                                   | never accepts `CANCELLED`; `{to, expectedVersion, reason?}`                                                             |
| `POST /api/v1/orders/:id/cancel`     | T `[orders.cancel]`                                                         | mandatory `reason`; `{expectedVersion, reason}`                                                                         |
| `POST /api/v1/orders/:id/reopen`     | T `[orders.reopen]`                                                         | COMPLETED & (vacuously) unbilled -> ACCEPTED                                                                            |

### Migrations added

`V202609182000__orders_core` (`orders` with no `bill_id`, `order_line`,
`order_line_addon`, `order_status_history`, every unique/CHECK constraint
from architecture section 8, plus the `table_session` composite-unique
defect fix), two new trigger functions + attachments in `R__triggers`
(the first _logic_ change to that file, not just a checksum-bump
comment), and checksum-bump comments in `R__grants`/`R__rls_policies`
(`order_status_history`'s append-only grant was already anticipated back
in Gate 2 — no logic change needed there).

### Test status (this gate)

- Backend DB integration (Jest, `test/db/`): **45 new tests** across five
  files — `gate6-orders-vertical.integration.spec.ts` (16: creation,
  session resolution/reuse, listing/filtering, editing, the full state
  machine in both workflow modes, reopen, cancel), `gate6-orders-
snapshot.integration.spec.ts` (6: the exact price/variant/addon/rename/
  deactivate immutability matrix from task §37), `gate6-orders-
idempotency.integration.spec.ts` (4: sequential replay, mismatch, two
  real-concurrency tests), `gate6-orders-concurrency.integration.spec.ts`
  (3: 20-way concurrent ACCEPT race, transition-vs-cancel race, rollback),
  `gate6-orders-tenant-isolation.integration.spec.ts` (16: Attacks A-O
  plus a SQL-layer cross-tenant proof) — run against both a genuinely
  fresh database and the existing upgraded one
- Backend unit (Jest): **12 new tests** — `order-transition.service.spec.ts`
  (7: state-machine validation, workflow-mode gating, permission
  enforcement, version-conflict mapping) and
  `idempotency-fingerprint.spec.ts` (5: key-order independence, array-order
  sensitivity, determinism)
- Contracts (Vitest): **13 new tests** in `orders.test.ts` — schema
  validation, server-owned-field stripping, query-param array
  normalization
- Frontend (Vitest + RTL): **9 new tests** — `orders-page.test.tsx` (4)
  and `order-detail-page.test.tsx` (5)
- Lint + build + format: all clean across `contracts`, `api`, `web`

### Security / adversarial tests (task §39, attacks A-O — all executed live)

| Attack                                                                | Result                                                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: Tenant A reads Tenant B order                                      | 404, absent from list                                                                                                                                                   |
| B: Tenant A modifies Tenant B order's lines                           | 404, unchanged                                                                                                                                                          |
| C: Tenant A transitions Tenant B order                                | 404, unchanged                                                                                                                                                          |
| D: Tenant A cancels Tenant B order                                    | 404, unchanged                                                                                                                                                          |
| E: Tenant A creates an order referencing Tenant B table               | 404                                                                                                                                                                     |
| F: Tenant A creates an order referencing Tenant B menu item           | 422 `ITEM_UNAVAILABLE`                                                                                                                                                  |
| G: Tenant A creates an order referencing Tenant B variant             | 422                                                                                                                                                                     |
| H: Tenant A creates an order referencing Tenant B addon               | 422                                                                                                                                                                     |
| I: client-supplied `tenantId` in the body                             | silently ignored; row lands under the authenticated tenant                                                                                                              |
| J: client-supplied fake `unitPricePaise`                              | ignored — server-resolved price used instead                                                                                                                            |
| K: client-supplied fake `lineTotalPaise`/`subtotalPaise`              | ignored — trigger-computed values used instead                                                                                                                          |
| L: client-supplied `status: "COMPLETED"` at creation                  | ignored — order is always created `NEW` (the field isn't even in the create schema)                                                                                     |
| M: authenticated user without the relevant permission (Kitchen Staff) | 403 on create/read/cancel/front-transition; the SAME user correctly succeeds on the one kitchen-transition they do hold, proving the guard isn't just blocking everyone |
| N: unauthenticated requests to all 7 endpoints                        | 401 on every one                                                                                                                                                        |
| O: `app_rw` `SET row_security = off`                                  | blocked with an error                                                                                                                                                   |

Plus a SQL-layer cross-tenant SELECT/UPDATE proof (not just the HTTP
layer) directly against `orders`.

### Snapshot tests (task §37, all six run against real Postgres)

Item price change, variant price change, addon price change, addon
removed from item, item deactivated, item renamed — in every case, an
already-created order's line(s) were re-read via `GET /orders/:id` after
the menu mutation and found byte-for-byte unchanged from their original
snapshot values.

### Idempotency tests (task §15-16, §34)

Sequential: same key + same body → 200 + `Idempotent-Replay: true`, same
order id; same key + different body → 409 `IDEMPOTENT_MISMATCH`, original
order unchanged. **Concurrency (mandatory, real HTTP concurrency, not
sequential):** 15 concurrent identical requests → exactly 1 `201`, 14
`200` replays, all pointing at the same single order (verified both via
response bodies and a follow-up `GET /orders`); 10 concurrent
_different_-body requests sharing one key → exactly 1 `201`, 9 `409
IDEMPOTENT_MISMATCH`.

### State-machine tests (task §9-11, §35)

Full `NEW -> ACCEPTED -> PREPARING -> READY -> COMPLETED` walk (KITCHEN
mode) with correct timestamp/permission/history effects at each step;
`NEW -> COMPLETED` shortcut correctly refused in KITCHEN mode and correctly
allowed in SIMPLE mode (`tenant_settings.orders_workflow` — defaults to
`SIMPLE`, not `KITCHEN`, per Gate 3's own migration); every terminal-state
transition attempt rejected. **Concurrency:** 20 concurrent `ACCEPT`
requests on one `NEW` order → exactly 1 succeeds, 19 rejected (a mix of
`VERSION_CONFLICT`/`INVALID_TRANSITION` depending on read timing — both
are correct rejections, the invariant under test is "at most one winner,"
not which specific 409 sub-code a loser gets); concurrent
transition-vs-cancel on the same order → exactly one of the two wins.

### Transaction / rollback tests (task §38)

A forced mid-creation failure (a valid first line, then a nonexistent
second item) rolls back the entire transaction — verified directly via
SQL that neither the `orders` row (keyed by its idempotency key) nor any
`order_line` row for the successfully-priced first item persisted.

### Architecture drift

PASS — no ORM/Redis/broker/Docker packages added; no `pg` import inside
the `orders` module; no client-controlled `tenant_id`/price/total
anywhere (confirmed by reading every controller method and by the live
Attacks I/J/K/L above); no `localStorage`/`sessionStorage` token storage;
no Billing/Payment code exists in the `orders` module beyond comments
documenting the Gate 8 deferral; no live menu-price joins used for
historical order data (the snapshot tests above are the proof, not just
a code-review claim).

### Non-blocking notes

- Jest's intermittent "did not exit one second after the test run"
  warning (pre-existing since Gate 2/3) reappeared at the same
  non-deterministic rate; Gate 6 adds no new connection/pooling logic
  beyond the established `withTenantTx` pattern.
- `/app/orders` ships list/create/detail/transition/cancel/reopen — the
  fuller `/app/counter` experience (table grid + menu picker + live
  order/session panel, architecture section 13) is intentionally not
  built; Gate 6's task brief asks for the order domain's screens, not
  that polished floor view, and nothing about it is blocked by this
  choice.
- The create-order UI supports item + variant + qty per line; add-on
  selection is not exposed in the UI (the API and backend fully support
  it, verified in `gate6-orders-vertical.integration.spec.ts`'s first
  test) — a presentation-layer scope cut, not a capability gap.

---

## Self-Service Onboarding — built and live-verified (Gate 7 paused for this)

Scope: a new foundational product flow — public landing → signup → auto-
login → first-time setup → dashboard — reconciled against the existing
architecture rather than invented from scratch. Gate 7 (Kitchen) and all
later gates (Billing, Payments, Public Ordering) remain untouched and
blocked, per explicit instruction, pending review of this work.

### Product flow implemented

```
/  (public landing)
  -> Get Started -> /signup
       -> POST /auth/signup (provision tenant + owner, auto-login)
       -> /app/setup (create first table, reuses Gate 4's POST /tables)
       -> /app (existing dashboard placeholder)

  -> Sign in -> /app/login (unchanged) -> POST /auth/login -> /app or
     /app/select-tenant (unchanged)
```

### Architecture decision

Full rationale is in `restaurant-saas-v1-architecture.md`'s new
"Self-service onboarding (added post-Gate-6)" subsection (API reference,
section 12) — not duplicated here. Summary: **Option A** from the task
brief — reuse the existing `PlatformService.provisionTenant()` transaction
and the existing `app_platform` DB role through a narrowly-scoped new
public entry point, rather than introducing a second DB role or a second
provisioning code path. `app_platform`'s grants were already exactly
`tenant, tenant_settings, role, role_permission, tenant_membership, user`
(+ read-only `permission`, append-only `audit_event`) before this work —
verified by reading `R__grants.sql` before writing any code — so the
security boundary the task asked for already existed; it only needed a
public, request-shape-constrained door onto it.

`provisionTenant()` gained one additive parameter,
`{ ownerName?, allowExistingOwner? }`, both optional and defaulting to the
exact original behavior — `POST /platform/tenants` is unchanged in every
respect (same contract, same behavior, same tests still passing). Signup
passes `ownerName` (a real field it has and the platform contract
doesn't) and `allowExistingOwner: false` (so it can never silently attach
a new tenant to an existing platform user, per task section 10).

### Endpoint

`POST /auth/signup` — public, no guard other than `SignupRateLimitGuard`.
Request: `{tenantName, ownerName, email, password, passwordConfirmation}`
(Zod-validated, password confirmation checked via `.refine()`). Response:
identical shape to `POST /auth/login`'s (`{accessToken, memberships[]}`)
— literally `signupResponseSchema = loginResponseSchema` in the contracts
package, since signup always produces exactly the single-membership case
login already special-cases into a tenant-bound token. Refresh token in
the same `HttpOnly; Secure; SameSite=Strict; Path=/auth` cookie
`setRefreshCookie()` already sets for login.

### Files changed

**DB**: `db/migrations/V202609190900__onboarding_rate_limit.sql` (new —
`public_rate_limit` table, pulled forward from its originally-planned
Public Ordering slot), `R__grants.sql` (one new `app_platform` grant on
that table).

**Backend**: `apps/api/src/modules/platform/signup.controller.ts`,
`signup.service.ts`, `signup-rate-limit.guard.ts`,
`public-rate-limit.repository.ts`, `tenant-slug.ts` (+
`tenant-slug.spec.ts`) — all new. `platform.service.ts` (additive
`provisionTenant()` options parameter, new exported
`TenantSlugConflictError`), `platform.module.ts` (registers the new
controller/service/guard/repository), `identity.module.ts` (exports
`AuthService` so the platform module can reuse it),
`common/config/env.schema.ts` (`SIGNUP_RATE_LIMIT_MAX_ATTEMPTS`/
`_WINDOW_MINUTES`, defaulting to 5/15 — same pattern as the existing
`LOGIN_LOCKOUT_THRESHOLD`).

**Contracts**: `packages/contracts/src/auth.ts` (`signupRequestSchema`,
`signupResponseSchema`), `index.ts` (exports).

**Tests**: `apps/api/src/modules/platform/tenant-slug.spec.ts` (unit, 8
tests), `apps/api/test/db/gate7-signup-vertical.integration.spec.ts`,
`gate7-signup-attack-matrix.integration.spec.ts`,
`gate7-signup-concurrency.integration.spec.ts`,
`gate7-signup-rate-limit.integration.spec.ts` (16 DB integration tests
total).

**Frontend**: `apps/web/src/routes/public/landing.tsx` (+ test),
`signup.tsx` (+ test), `apps/web/src/routes/staff/setup.tsx` (+ test),
`apps/web/src/features/auth/use-auth.ts` (`useSignup`), `App.tsx` (new
`/`, `/signup`, `/app/setup` routes), `login.tsx` (link to signup),
`App.test.tsx` (updated: `/` now renders the landing page, not a
redirect — the old assertion described the pre-onboarding placeholder
behavior, not a regression).

**Docs**: `restaurant-saas-v1-architecture.md` (new API row + new
subsection, both minimal, nothing else touched), this file.

### Database

- `public_rate_limit(key TEXT PRIMARY KEY, window_start TIMESTAMPTZ,
count INT)` — no `tenant_id`, so (like `login_attempt`/
  `platform_admin`) it is correctly NOT picked up by the dynamic
  `R__rls_policies.sql` scan; RLS doesn't apply to a table with no tenant
  to isolate by.
- `app_platform` grant: `SELECT, INSERT, UPDATE` on `public_rate_limit`
  only (no `DELETE` — pruning is a separate cron concern, matching the
  architecture's own note for this table; verified live that a test
  attempting `DELETE` as `app_platform` is correctly rejected with
  "permission denied").
- No RLS policy changed. No table's grants were widened beyond this one
  addition. `app_rw`/`app_public` grants are completely untouched.

### Verification

- Contracts: **29/29**
- Backend non-DB: **81/81** (includes the new 8-test `tenant-slug.spec.ts`)
- Backend DB integration: **131/131** (17 suites — the 16 new Gate 7
  onboarding tests plus all 115 pre-existing Gate 1-6 tests, run against
  both a genuinely fresh database and the existing upgraded
  `rewardbite_dev`, identical pass counts both times)
- Frontend: **52/52** (10 new tests across landing/signup/setup pages)
- Build: **PASS**
- Lint: **PASS**
- Format: **PASS**
- RLS coverage: **0 violations** (18 tenant tables — unchanged count;
  `public_rate_limit` correctly excluded)
- Fresh DB: **PASS** (15 migrations applied cleanly from an empty
  database, 0 RLS violations, full 131-test DB suite green)
- Upgrade DB: **PASS** (migration applied cleanly on top of the existing
  Gate 1-6 schema, full 131-test DB suite green)

### Security tests (task section 22, Attacks A-J)

All executed live against real Postgres/HTTP. A: client-supplied
`tenantId` ignored. B: client-supplied `roleId` ignored, owner still gets
the real Owner role. C: signup payload cannot target a membership in an
existing (seeded) tenant. D: signup cannot modify/reuse an existing
tenant's slug (collision suffix instead). E: existing-email signup safely
rejected (409), not silently attached. F: 10 concurrent signups for the
same email -> exactly 1 succeeds (see Concurrent signup below). G:
forced mid-transaction failure -> zero orphan rows (see Rollback below).
H: unauthenticated `/auth/signup` returns exactly `{accessToken,
memberships}`, nothing else. I: a signup-created owner token gets 401
against `POST /platform/tenants` (`PlatformBootstrapGuard` needs the
bootstrap secret header, which a tenant JWT can never satisfy). J: the
platform bootstrap secret cannot be used as a tenant Bearer token (401
from `AuthGuard`).

### Concurrent signup (task section 23)

10 concurrent signups for the _same email_ -> exactly 1 `200`, 9 `409`;
exactly 1 `user` row and 1 `tenant_membership` row exist afterward. This
required a real fix during development: the first application-level
pre-check (`findByEmail`) is a plain SELECT, not a lock, so two truly
concurrent requests can both pass it before either commits — the second
one previously surfaced the raw `user_email_unique` violation as an
unhandled 500. Fixed by catching that specific constraint violation and
mapping it to the same safe 409 the common-case pre-check already
throws — the database is the final arbiter, exactly as required. 8
concurrent signups for the _same restaurant name_ (different emails) all
succeed with 8 distinct, collision-free slugs, verified both via the HTTP
responses and a direct `tenant` table count.

### Rollback tests (task section 24)

A realistic mid-transaction failure (second signup attempt with an
already-taken email, which throws only after `tenant`/`tenant_settings`/
4 `role` rows/~35 `role_permission` rows have already been written inside
the same transaction) leaves zero orphan `tenant` rows — verified by
direct SQL. Produced by real application logic reaching a real failure
point partway through, not an injected test-only fault.

### Existing Gate 1-6 regression

**All green, unchanged.** `POST /platform/tenants` (Gate 2) was not
touched behaviorally in any way — same contract, same response, same
error on slug conflict (now a named `TenantSlugConflictError` subclass of
`ConflictException`, but same status/message, so no observable change).
Gates 3-6 DB integration tests all still pass at their original counts.

### Architecture drift

**PASS** — no Redis/message broker/CAPTCHA added (task explicitly
forbade all three); no new DB role; no RLS weakened or bypassed; the rate
limiter is honestly documented as a V1 application-level layer, not
claimed as distributed edge protection; no Kitchen/Billing/Payments/
Public-Ordering code exists anywhere in this change.

### Non-blocking notes

- Two real bugs were found and fixed only by running against a live
  database (neither catchable by static review): (1) the slug-collision
  retry loop didn't originally catch `provisionTenant()`'s own pre-check
  `ConflictException` (only the raw DB constraint violation), so the
  common non-racy collision case failed instead of retrying — fixed by
  giving that specific exception its own subclass,
  `TenantSlugConflictError`, so the retry logic can distinguish it from
  the (must-not-retry) email conflict without string-matching. (2) raw
  test-assertion queries against `tenant`/`tenant_membership` need
  `app.actor_kind`/`app.user_id` context set (RLS applies to `app_platform`
  too) — fixed by routing them through `withGlobalTx`, the same
  established pattern `rls-tenant-membership.integration.spec.ts` already
  uses for exactly this reason.
- The rate-limit check originally lived in `SignupService`, which runs
  _after_ Zod validation — meaning a malformed-payload flood would have
  bypassed it entirely. Moved to a Guard (`SignupRateLimitGuard`), which
  Nest's pipeline runs _before_ pipes, closing that gap.
- `/app/setup` is intentionally minimal (one step: first table) per the
  task's explicit "do not build a giant wizard" instruction — it does not
  prompt for menu items, staff invites, or settings.
