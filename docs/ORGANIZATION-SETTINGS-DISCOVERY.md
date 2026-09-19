# Organization Settings — Architecture Discovery

> **Status:** DISCOVERY ONLY — No implementation files created. No migrations. No commits.
> **Date:** 2026-09-19
> **Gate:** Pre-Gate-11 discovery (separate from Gate 11: Public Ordering)

---

## 1. Skills Activated

| Skill                               | Reason                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `@brainstorming`                    | Structured design-before-implementation discipline                 |
| `@writing-plans`                    | Discovery document format and plan conventions                     |
| `@verification-before-completion`   | Evidence-backed claims only — every statement verified from source |
| `@receiving-code-review`            | Evaluate discoveries technically, not assumptively                 |
| `@requesting-code-review`           | Prepare for implementation review checkpoint                       |
| `@systematic-debugging`             | Trace existing behavior from DB → service → frontend               |
| `@database-admin`                   | RLS, grants, tenant isolation analysis                             |
| `@supabase-postgres-best-practices` | Multi-tenant PostgreSQL patterns                                   |

---

## 2. Current Architecture — What Exists Today

### Database Layer

**`tenant_settings` table** (from `V202609180902__tenant_core.sql`):

```sql
CREATE TABLE tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenant (id),
  orders_workflow TEXT NOT NULL DEFAULT 'SIMPLE' CHECK (...),
  qr_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  customer_name_required BOOLEAN NOT NULL DEFAULT false,
  auto_accept BOOLEAN NOT NULL DEFAULT false,
  kitchen_display_enabled BOOLEAN NOT NULL DEFAULT false,
  print_slip_on_new BOOLEAN NOT NULL DEFAULT false,
  cash_enabled BOOLEAN NOT NULL DEFAULT true,
  upi_enabled BOOLEAN NOT NULL DEFAULT false,   -- opt-in
  upi_id TEXT,                                   -- nullable, no format constraint today
  upi_reference_required BOOLEAN NOT NULL DEFAULT true,
  paper TEXT NOT NULL DEFAULT '80mm',
  bill_footer TEXT,
  round_to_rupee BOOLEAN NOT NULL DEFAULT false, -- patched to TRUE in V202609191400
  max_discount_bp INT NOT NULL DEFAULT 5000,
  business_day_starts_at TIME NOT NULL DEFAULT '04:00',
  extra JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- **One row per tenant** (PK = `tenant_id`)
- **No `version` column** (no optimistic concurrency today)
- **`updated_at` exists** (set at creation; not auto-updated by trigger — service must set explicitly)
- Created by `TenantRepository.createDefaultSettings()` during `PlatformService.provisionTenant()`

### RLS on `tenant_settings`

`R__rls_policies.sql` applies the **catalog-driven generic policy**:

```sql
CREATE POLICY tenant_isolation ON public.tenant_settings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;
```

- `app_rw` **can UPDATE** as long as `app.tenant_id` GUC matches the row
- Cross-tenant UPDATE is blocked at DB level by `WITH CHECK`
- No GUC → policy evaluates to NULL → fail-closed (0 rows affected)

### Grants

| Role           | `tenant_settings`                                              |
| -------------- | -------------------------------------------------------------- |
| `app_rw`       | `SELECT, INSERT, UPDATE, DELETE` (generic loop — no exception) |
| `app_platform` | `SELECT, INSERT, UPDATE` (provisioning)                        |
| `app_migrator` | DDL; NOBYPASSRLS = false                                       |
| `app_public`   | None                                                           |

### Permission Catalog (Already Seeded — No New Permissions Needed)

From `V202609180904__data_seed_permissions.sql`:

```sql
('settings.read',            'Read tenant settings'),
('settings.update',          'Update tenant settings'),
('settings.payments.manage', 'Update payment-related settings (UPI id, payment toggles)'),
```

### System Role → Permission Matrix (Source: `system-role-templates.ts`)

| Role              | `settings.read` | `settings.update` |      `settings.payments.manage`       |
| ----------------- | :-------------: | :---------------: | :-----------------------------------: |
| **Owner**         |       ✅        |        ✅         |                  ✅                   |
| **Manager**       |       ✅        |        ✅         | ❌ (explicitly in `MANAGER_EXCLUDED`) |
| **Cashier**       |       ❌        |        ❌         |                  ❌                   |
| **Kitchen Staff** |       ❌        |        ❌         |                  ❌                   |

`MANAGER_EXCLUDED = new Set(['users.manage', 'settings.payments.manage', 'tenant.delete'])` — already locked in code and DB.

### How Payment Settings Are Consumed Today (Gate 8 Trace)

```
tenant_settings.upi_enabled / upi_reference_required / cash_enabled
  ↓
BillRepository.getBillingSettings(tx, tenantId)
  SELECT round_to_rupee, max_discount_bp, cash_enabled, upi_enabled, upi_reference_required
  FROM tenant_settings WHERE tenant_id = $1
  ↓
PaymentsService.validateMethod(tx, tenantId, input)
  if (!upiEnabled) → DomainError(422, 'PAYMENT_METHOD_DISABLED', 'UPI payments are turned off.')
  if (!cashEnabled) → DomainError(422, 'PAYMENT_METHOD_DISABLED', 'Cash payments are turned off.')
  ↓
POST /api/v1/payments
```

Settings evaluated **at payment time only** — not cached, not snapshot into payment records. Changes affect future payments only.

### Frontend: Current State

- `AppShell` nav: `/app/settings/users` exists (guarded by `users.read`)
- `App.tsx` route: `settings/users` → `<UsersPage />`
- **No settings page for organization/payment settings exists**
- `<Can permission="...">` gates UI by checking `me.permissions[]`
- `PaymentPanel` shows `CASH` and `UPI_STATIC` dropdown unconditionally (no awareness of `upi_enabled` state)

### Current `tenant_settings` Defaults

| Column                   | Default | Notes                      |
| ------------------------ | ------- | -------------------------- |
| `cash_enabled`           | `true`  | DB column default          |
| `upi_enabled`            | `false` | DB column default — opt-in |
| `upi_id`                 | `NULL`  | No validation constraint   |
| `upi_reference_required` | `true`  | DB column default          |

All 50 dev tenant rows confirmed at `upi_enabled = false`.

---

## 3. Problem

There is no API endpoint or UI for authorized users to manage organization settings. The only way to change `upi_enabled` is a direct SQL `UPDATE tenant_settings`. The Gate 8 architecture explicitly stated: "there is no settings API in V1."

---

## 4. Goals

1. Authenticated restaurant **owners** can read and update payment settings through the UI
2. **Managers** can read but NOT change payment settings
3. **Cashiers** and **kitchen staff** have no access
4. No cross-tenant contamination at any layer
5. Every change audited in the same transaction
6. Architecture supports additional settings without creating a one-off endpoint

---

## 5. Non-Goals

- Generic enterprise key/value config store
- Real-time settings sync across sessions
- Settings versioning / history UI
- Rollback of settings changes
- Platform admin editing tenant settings via the settings API
- Changing billing calculation logic (`round_to_rupee`, `max_discount_bp`) in this feature
- Onboarding flow integration

---

## 6. Proposed Architecture

```
Browser (settings/payments page)
  ↓
  GET  /api/v1/organization/settings   [settings.read]
  PATCH /api/v1/organization/settings  [settings.payments.manage]
  ↓
AuthGuard → TenantGuard → PermissionGuard
  ↓
SettingsController  (new, in TenancyModule)
  ↓
SettingsService  (new, in TenancyModule)
  ↓
withTenantTx(pool, { tenantId, userId, actorKind: 'staff' })
  ↓
SettingsRepository  (SELECT/UPDATE tenant_settings)
  ↓
RLS: tenant_isolation: tenant_id = app.tenant_id GUC
  ↓
recordAuditEvent({ entityType: 'tenant_settings', before, after })
  ↓
Return OrganizationSettings response
```

### Module Ownership: Extend `TenancyModule`

`TenancyModule` already owns `TenantRepository` which creates the `tenant_settings` row. `tenant_settings` is the tenant's configuration. Adding `SettingsController` + `SettingsRepository` avoids a new module with zero additional dependencies.

**Alternative rejected:** New `SettingsModule` — YAGNI. One table, one domain.

---

## 7. Authorization Model

### Permissions (No New Permissions — All Already Seeded)

| Action                         | Required Permission        | Roles          |
| ------------------------------ | -------------------------- | -------------- |
| `GET /organization/settings`   | `settings.read`            | Owner, Manager |
| `PATCH /organization/settings` | `settings.payments.manage` | **Owner only** |

### Guard Stack (Identical Pattern to Existing Routes)

```ts
@Controller('organization/settings')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class SettingsController {
  @Get()
  @RequirePermission('settings.read')
  async getSettings(@CurrentUser() user: AuthenticatedUser) { ... }

  @Patch()
  @RequirePermission('settings.payments.manage')
  async updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: ...) { ... }
}
```

---

## 8. Data Model

### Existing `tenant_settings` — SUFFICIENT. No New Table. No New Columns.

| Field                    | Type               | Nullable | Validation                                                                         | Who Can Change | Audited |
| ------------------------ | ------------------ | -------- | ---------------------------------------------------------------------------------- | -------------- | ------- |
| `cash_enabled`           | `BOOLEAN NOT NULL` | No       | —                                                                                  | Owner          | Yes     |
| `upi_enabled`            | `BOOLEAN NOT NULL` | No       | See business rules                                                                 | Owner          | Yes     |
| `upi_id`                 | `TEXT`             | Yes      | Trimmed; max 100 chars; no control characters. No VPA grammar (locked decision 15) | Owner          | Yes     |
| `upi_reference_required` | `BOOLEAN NOT NULL` | No       | —                                                                                  | Owner          | Yes     |

**`updated_at`:** Service must explicitly set `updated_at = now()` in the UPDATE query. No trigger exists today.

---

## 9. API Contract

### `GET /api/v1/organization/settings`

**Permission:** `settings.read`

**Response:**

```json
{
  "data": {
    "cashEnabled": true,
    "upiEnabled": false,
    "upiId": null,
    "upiReferenceRequired": true
  }
}
```

Only the four payment columns are exposed. `orders_workflow`, `round_to_rupee`, etc. are NOT in this response.

---

### `PATCH /api/v1/organization/settings`

**Permission:** `settings.payments.manage`

**Request body (all optional — PATCH semantics):**

```json
{
  "cashEnabled": true,
  "upiEnabled": true,
  "upiId": "restaurant@hdfc",
  "upiReferenceRequired": true
}
```

**Business rules (applied to merged resulting state):**

1. If resulting `upiEnabled = true` → `upiId` must be non-null and non-empty
2. If resulting `cashEnabled = false && upiEnabled = false` → `PAYMENT_METHOD_REQUIRED` 422
3. `upiId` is trimmed, at most 100 characters, with no control characters (PostgreSQL TEXT cannot hold NUL). There is deliberately **no VPA format regex**.
4. Empty or whitespace-only `upiId` → treated as null
5. `upiId = null` valid when `upiEnabled = false`

**Response:** Same shape as GET.

**Error codes:**

- `VALIDATION_FAILED` (**400**, request-shape rule via `ZodValidationPipe`) — unknown field, wrong type, `upiId` over 100 characters or containing a control character
- `UPI_ID_REQUIRED` (422) — `upiEnabled=true` but `upiId` is null
- `PAYMENT_METHOD_REQUIRED` (422) — attempt to disable all payment methods
- `403` — insufficient permission

---

### Update Semantics

PATCH (partial update). Server reads current row, merges submitted fields, validates combined state, writes merged result. Clients need not send all fields.

---

## 10. Concurrency

**Current state:** No `version` column. `updated_at` exists.

**V1 recommendation:** Last-writer-wins. Direct `UPDATE ... SET updated_at = now()` inside `withTenantTx`. Settings are low-frequency administrative mutations — simultaneous edits from two owners of the same tenant is an extremely unlikely production scenario.

**Future option (if needed):** Add `settings_version INT DEFAULT 0` + client sends `expectedVersion` in PATCH. Same pattern as `bill.version`.

> [!NOTE]
> **Decision #12 (resolved): no optimistic concurrency in V1 — last writer wins.** PATCH still runs its read-merge-validate-write under a `SELECT … FOR UPDATE` row lock on the tenant's `tenant_settings` row. That is a pessimistic lock, not versioning: it serializes writers so each validates against the state the previous one committed. Without it, two concurrent PATCHes (`cashEnabled=false` and `upiEnabled=false`) could each pass validation and together leave both methods off. Only fields that actually change are written, so concurrent edits to different fields both survive; concurrent edits to the same field resolve to the last writer.

---

## 11. Audit Events

Every successful PATCH that changes at least one field must emit an audit event **inside the same transaction**:

```typescript
await recordAuditEvent(tx, {
  entityType: 'tenant_settings',
  entityId: tenantId,
  action: 'payment_settings_updated',
  actorKind: 'staff',
  actorId: userId,
  before: { cashEnabled, upiEnabled, upiId, upiReferenceRequired },
  after: { cashEnabled, upiEnabled, upiId, upiReferenceRequired },
});
```

- UPI IDs are merchant-facing VPAs (`restaurant@hdfc`) — NOT credentials — safe to log
- No audit event if submitted values equal current values
- `requestId` can be populated from request context if available

---

## 12. RLS / Security Threat Model

| Threat                                       | Defense                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tenant A updates Tenant B settings           | RLS `WITH CHECK`: `tenant_id = app.tenant_id` GUC. GUC set from verified JWT `tid`, never client input                              |
| Forged `tenant_id` in request body           | Contract never accepts `tenant_id` from body                                                                                        |
| Missing/empty GUC                            | `NULLIF('', '')::uuid` = NULL → fail-closed                                                                                         |
| Malformed GUC                                | `::uuid` cast error → transaction aborts                                                                                            |
| Stale tenant context                         | JWT `rv` claim vs DB `security_version`                                                                                             |
| Staff updates settings                       | `PermissionGuard` → 403                                                                                                             |
| Manager updates payment settings             | `settings.payments.manage` in `MANAGER_EXCLUDED` → 403                                                                              |
| Unauthenticated request                      | `AuthGuard` → 401                                                                                                                   |
| `upiId` containing HTML/script               | Stored as inert TEXT and returned as JSON data (no VPA grammar is imposed); control characters and >100 chars are rejected with 400 |
| SQL injection via `upiId`                    | Parameterized queries throughout                                                                                                    |
| UPI enabled without UPI ID                   | Service validates: `UPI_ID_REQUIRED` 422                                                                                            |
| Both methods disabled                        | Service validates: `PAYMENT_METHOD_REQUIRED` 422                                                                                    |
| Settings change affecting in-flight payments | Settings evaluated at `POST /payments` time — a payment already inside its transaction is unaffected                                |
| Settings change affecting finalized bills    | No effect — all payments already recorded                                                                                           |
| `app_rw` UPDATE without GUC                  | `FORCE ROW LEVEL SECURITY` → 0 rows affected                                                                                        |
| Platform admin forging tenant context        | No settings API endpoint for platform role                                                                                          |
| `app_rw` BYPASSRLS                           | `assertNoBypassRls()` in `main.ts` confirms at startup                                                                              |

---

## 13. Frontend UX

### Routing

**New route:** `/app/settings/payments`

Precedent: `/app/settings/users` already exists. `settings/` prefix is established.

**`App.tsx`:**

```tsx
<Route path="settings/payments" element={<PaymentSettingsPage />} />
```

**`app-shell.tsx` nav addition:**

```tsx
{ to: '/app/settings/payments', label: 'Payments', permission: 'settings.read' as const },
```

### Screen Layout

```
Organization Settings — Payments

───────────────────────────────────────
Cash Payments
Accept cash payments at the counter
[ Toggle ON/OFF ]

───────────────────────────────────────
UPI Payments
Accept payments via UPI
[ Toggle ON/OFF ]

  (visible when UPI is ON or being enabled)
  UPI ID
  [ restaurant@hdfc          ]
  Your UPI VPA, e.g. name@bank

  Require UTR / Reference
  Cashier must enter the 12-digit transaction reference
  [ Toggle ON/OFF ]

───────────────────────────────────────
[ Save changes ]   ← disabled if no changes or insufficient permission
```

### UX Rules

1. Manager sees the page (has `settings.read`) with every current value shown read-only (checkboxes disabled, UPI ID `readonly`), no Save button, and a note that they cannot change these settings. Users without `settings.read` see a no-access message and the settings are never requested.
2. The UPI ID and UTR controls are always visible, so a stored ID (preserved while UPI is off) is never hidden
3. UPI ON + empty UPI ID → inline error before submission
4. Turning both OFF → "At least one payment method must remain active" warning
5. Success: "Payment settings saved" toast
6. Error: API domain error displayed
7. Labels in user language only — never SQL column names
8. All toggle controls have `aria-label`
9. Save button shows loading state during mutation

### Responsive

- 390px: single column, full-width toggles
- 768px+: max-width card, comfortable spacing
- Follows existing `Card`, `Label`, `Button`, `Input` design system patterns

---

## 14. Defaults and Onboarding

Provisioning defaults (verified from source):

- `cash_enabled = true`, `upi_enabled = false`, `upi_id = NULL`, `upi_reference_required = true`

> [!IMPORTANT]
> **Open Decision #10:** Should onboarding include a payment setup step?

**Recommendation:** No. Keep onboarding minimal. Settings page is the exclusive configuration path.

---

## 15. Backward Compatibility

| Gate 8 Invariant             | Status                                        |
| ---------------------------- | --------------------------------------------- |
| Full settlement (no partial) | ✅ Untouched                                  |
| Payment insert-only ledger   | ✅ Untouched                                  |
| UPI UTR validation           | ✅ `PaymentsService.validateMethod` unchanged |
| Payment idempotency          | ✅ Unchanged                                  |
| Bill finalization            | ✅ Unchanged                                  |
| Bill void semantics          | ✅ Unchanged                                  |

Settings only gate whether a future `POST /payments` is allowed. Existing PAID bills are unaffected.

---

## 16. Test Strategy

### API Integration Tests

| Test                                                    | Expected                                   |
| ------------------------------------------------------- | ------------------------------------------ |
| Owner reads settings                                    | 200                                        |
| Manager reads settings                                  | 200                                        |
| Cashier reads settings                                  | 403                                        |
| Unauthenticated reads                                   | 401                                        |
| Owner patches `upiEnabled: true, upiId: 'r@hdfc'`       | 200, persisted                             |
| Owner patches `upiEnabled: true` (no UPI ID)            | 422 `UPI_ID_REQUIRED`                      |
| Owner disables both methods                             | 422 `PAYMENT_METHOD_REQUIRED`              |
| Owner sends a 101-character or control-character UPI ID | 400 `VALIDATION_FAILED`                    |
| Manager patches payment settings                        | 403                                        |
| Cross-tenant read/write                                 | RLS blocks → 0 rows / 403                  |
| Audit event after successful PATCH                      | `audit_event` row exists with before/after |
| No audit event if nothing changed                       | No insert                                  |

### DB/RLS Tests

| Test                                       | Expected                     |
| ------------------------------------------ | ---------------------------- |
| `app_rw` UPDATE with wrong `app.tenant_id` | 0 rows affected              |
| `app_rw` UPDATE with no GUC                | 0 rows affected (RLS blocks) |

### Frontend Tests

| Test                                 | Expected                  |
| ------------------------------------ | ------------------------- |
| Page loads with current settings     | Toggles reflect DB state  |
| Manager sees read-only view          | Save hidden/disabled      |
| Toggle UPI ON → UPI ID field appears | Conditional render        |
| Submit with UPI ON + empty UPI ID    | Inline error, no API call |
| Successful save → success feedback   |                           |
| API error → error message            |                           |
| All controls keyboard-accessible     |                           |
| 390px / 768px breakpoints            | No overflow               |

### Regression

| Test                                     | Expected  |
| ---------------------------------------- | --------- |
| Gate 8 full test suite                   | All green |
| UPI disabled → `PAYMENT_METHOD_DISABLED` | Preserved |
| Cash payment → recorded                  | Preserved |

---

## 17. Open Product Decisions

These require explicit confirmation before implementation:

| #   | Decision                                          | Discovery Recommendation          |
| --- | ------------------------------------------------- | --------------------------------- |
| 1   | Can cash be disabled?                             | YES (guard prevents both-off)     |
| 2   | Must UPI ID be present before enabling UPI?       | YES                               |
| 3   | Is UPI ID preserved when UPI is disabled?         | YES (don't null on disable)       |
| 4   | Is UTR toggle independent of UPI enabled?         | YES                               |
| 5   | Can both cash and UPI be disabled simultaneously? | NO — `PAYMENT_METHOD_REQUIRED`    |
| 6   | Who can modify payment settings?                  | Owner only                        |
| 7   | Platform admins modify tenant settings via API?   | NO                                |
| 8   | Settings changes require a reason field?          | NO                                |
| 9   | Settings changes audited?                         | YES — mandatory, same transaction |
| 10  | Settings in onboarding?                           | NO                                |
| 11  | Settings changes affect only future payments?     | YES                               |
| 12  | Need optimistic concurrency?                      | NO for V1                         |

---

## 18. Recommended Implementation Sequence

> Execute ONLY after open decisions confirmed.

| Step | What                                                                                   | Files                                                       |
| ---- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1    | Contracts — `OrganizationPaymentSettings` + `UpdatePaymentSettingsRequest` Zod schemas | `packages/contracts/src/settings.ts` (NEW)                  |
| 2    | Backend — `SettingsRepository`                                                         | `apps/api/src/modules/tenancy/settings.repository.ts` (NEW) |
| 3    | Backend — `SettingsService` (merge, validate, update, audit)                           | `apps/api/src/modules/tenancy/settings.service.ts` (NEW)    |
| 4    | Backend — `SettingsController` (`GET` + `PATCH`)                                       | `apps/api/src/modules/tenancy/settings.controller.ts` (NEW) |
| 5    | Backend — register in `TenancyModule`                                                  | `apps/api/src/modules/tenancy/tenancy.module.ts` (MODIFY)   |
| 6    | Backend integration tests                                                              | `apps/api/test/db/settings.integration.spec.ts` (NEW)       |
| 7    | Frontend — `useOrganizationSettings` + `useUpdatePaymentSettings`                      | `apps/web/src/features/settings/use-settings.ts` (NEW)      |
| 8    | Frontend — `PaymentSettingsPage` + tests                                               | `apps/web/src/routes/staff/payment-settings-page.tsx` (NEW) |
| 9    | Frontend — register route + nav item                                                   | `App.tsx` (MODIFY), `app-shell.tsx` (MODIFY)                |

---

## 19. Risks

| Risk                                                 | Likelihood | Mitigation                                                  |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| Manager accidentally gets `settings.payments.manage` | Low        | `MANAGER_EXCLUDED` already in DB + code                     |
| UPI enabled without UPI ID                           | Medium     | Service + frontend validation prevents this state           |
| Both methods disabled by accident                    | Medium     | `PAYMENT_METHOD_REQUIRED` 422 validation                    |
| Audit row lost                                       | Low        | `recordAuditEvent` inside `withTenantTx` — fails → rollback |
| Cross-tenant bypass                                  | Minimal    | `FORCE ROW LEVEL SECURITY` + `assertNoBypassRls`            |
| UPI ID leaking PII                                   | None       | VPAs are public merchant identifiers                        |

---

## 20. Files Changed

**Zero implementation files created or modified.**

**Discovery document created:** `docs/ORGANIZATION-SETTINGS-DISCOVERY.md`

**Git status:** No commits. No push.

---

## 21. Red-Team Results

| Attack                                        | Fix Applied                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Staff modifies settings                       | `PermissionGuard` → 403 confirmed                                        |
| Manager modifies payment settings             | `settings.payments.manage` in `MANAGER_EXCLUDED` — confirmed from source |
| API trusts `tenantId` from request body       | Contract never accepts `tenantId` from body                              |
| UPI enabled without UPI ID                    | `UPI_ID_REQUIRED` service + frontend validation added                    |
| Both payment methods disabled                 | `PAYMENT_METHOD_REQUIRED` validation added                               |
| Concurrent admin overwrites                   | Documented explicitly as last-writer-wins V1 decision                    |
| `actorId` forged from client                  | `actorId` = `user.userId` from verified JWT only                         |
| RLS bypassed                                  | `assertNoBypassRls()` at startup + `FORCE ROW LEVEL SECURITY`            |
| Settings change retroactively breaks payments | Settings evaluated at payment time only — confirmed                      |
| Second source of truth for settings           | `BillRepository.getBillingSettings` reads same `tenant_settings` table   |
