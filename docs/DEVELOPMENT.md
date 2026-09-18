# Development

Gate 2 (Tenancy + Identity) foundation for RewardBite. This document is the
practical companion to `docs/IMPLEMENTATION_STATUS.md` — start here to get
the repo running.

## Package manager

**npm workspaces.** Chosen because:

- The repository is greenfield with no pre-existing package manager to
  respect.
- The root `package.json` already declares `"workspaces": ["apps/*",
"packages/*"]` and a single root lockfile (`package-lock.json`) is enough
  for three small workspaces — no need for pnpm's stricter node_modules
  isolation or Yarn's Plug'n'Play at this scale.
- Zero extra global tooling to install: `npm` ships with Node.

All commands below run from the **repository root** unless noted.

## Prerequisites

| Tool       | Version                          | Notes                                                                                                                                                                                                 |
| ---------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 22.x (see `.nvmrc`)              | Render production runs Node 22. Newer LTS Node also works locally (`engines.node` in `package.json` is `>=20 <24`); use `nvm use` to match production exactly.                                        |
| npm        | bundled with Node 22             |                                                                                                                                                                                                       |
| PostgreSQL | 16+                              | Local install (native, not Docker — the architecture explicitly excludes Docker).                                                                                                                     |
| Flyway CLI | 10.x                             | `choco install flyway` (Windows), `brew install flyway` (macOS), or download the [command-line distribution](https://documentation.red-gate.com/fd/command-line-184127404.html) and put it on `PATH`. |
| `psql`     | matching your PostgreSQL install | Used by `scripts/db-init.sql`.                                                                                                                                                                        |
| Java       | 17+                              | Required by the Flyway CLI itself.                                                                                                                                                                    |

## Install

```bash
npm install
```

Installs all three workspaces (`apps/web`, `apps/api`, `packages/contracts`)
from the single root lockfile.

## Environment

Copy `.env.example` to `apps/api/.env` (NestJS reads it via `process.env`,
loaded by whatever mechanism you use to run the process — e.g. `dotenv` in
your shell, or your editor's run configuration) and fill in at minimum:

```text
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://app_rw:<app_rw_password>@localhost:5432/rewardbite
PLATFORM_DATABASE_URL=postgres://app_platform:<app_platform_password>@localhost:5432/rewardbite
JWT_SECRET=<any random string, 32+ characters>
PLATFORM_BOOTSTRAP_SECRET=<any random string, 16+ characters>
```

`PLATFORM_DATABASE_URL` and `PLATFORM_BOOTSTRAP_SECRET` are Gate 2
additions beyond the architecture's original `.env.example` catalogue —
see `docs/IMPLEMENTATION_STATUS.md` for why. `JWT_ACCESS_TTL` (default
`15m`), `REFRESH_TOKEN_TTL_DAYS` (default `30`), and
`LOGIN_LOCKOUT_THRESHOLD` (default `5`) have sane defaults and don't need
to be set locally.

`.env` is git-ignored. Never commit real secrets.

For the frontend, `apps/web/.env.local` can set `VITE_API_BASE_URL`
(defaults to `http://localhost:3000/api/v1`) if the API isn't running on
the default port.

## Local PostgreSQL setup

1. Create an empty database (name is up to you; examples below use
   `rewardbite`):

   ```bash
   createdb rewardbite
   ```

2. Run `scripts/db-init.sql` **once**, as a superuser, to create the four
   roles (`app_migrator`, `app_rw`, `app_public`, `app_platform`) and hand
   schema ownership to `app_migrator`:

   ```bash
   PGPASSWORD=<your-postgres-superuser-password> \
   PGDATABASE=rewardbite \
   PGUSER=postgres \
   APP_MIGRATOR_PASSWORD=<pick-one> \
   APP_RW_PASSWORD=<pick-one> \
   APP_PUBLIC_PASSWORD=<pick-one> \
   APP_PLATFORM_PASSWORD=<pick-one> \
   npm run db:init
   ```

   (`npm run db:init` is a thin wrapper around `psql -f scripts/db-init.sql`
   — see the script for the equivalent raw `psql` invocation if you'd
   rather run it directly.)

3. Run Flyway migrations, connecting as `app_migrator`:

   ```bash
   FLYWAY_URL=jdbc:postgresql://localhost:5432/rewardbite \
   FLYWAY_USER=app_migrator \
   FLYWAY_PASSWORD=<the app_migrator password from step 2> \
   npm run db:migrate
   ```

   As of Gate 2 this applies: `V..._extensions`, `V..._db_roles`,
   `V..._global_identity` (user, refresh_token, login_attempt,
   platform_admin), `V..._permission_catalog`, `V..._tenant_core` (tenant,
   tenant_settings, role, role_permission, tenant_membership),
   `V..._tenant_counter`, `V..._data_seed_permissions`, and
   `V..._audit_foundation` (audit_event only — see
   `docs/IMPLEMENTATION_STATUS.md` for why this was pulled forward), plus
   the repeatables `R__rls_policies`, `R__grants`, `R__triggers`. Still no
   business/operational tables (orders, bills, payments, ...).

4. Verify RLS coverage:

   ```bash
   RLS_CHECK_DATABASE_URL=postgres://postgres:<pw>@localhost:5432/rewardbite \
   npm run db:rls-coverage
   ```

5. Confirm `app_rw` cannot bypass RLS (also checked automatically at API
   startup — see `apps/api/src/common/db/assert-no-bypass-rls.ts`):

   ```sql
   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'app_rw';
   -- expect rolbypassrls = f
   ```

## Bootstrapping a tenant locally

There's no `platform_admin` login yet (see
`docs/IMPLEMENTATION_STATUS.md`), so tenant creation is gated by a
pre-shared secret instead:

```bash
curl -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Content-Type: application/json" \
  -H "x-platform-bootstrap-secret: $PLATFORM_BOOTSTRAP_SECRET" \
  -d '{"name":"My Restaurant","slug":"my-restaurant","ownerEmail":"owner@example.com","ownerPassword":"a-real-password-123"}'
```

This creates the tenant, its default settings, the four system roles
(Owner/Manager/Cashier/Kitchen Staff) with their permission mappings, and
an Owner membership for `ownerEmail` (created fresh if that email doesn't
exist yet). Then sign in at `/app/login` with that email/password.

## Running the DB integration tests

`apps/api/test/db/*.integration.spec.ts` — `withTenantTx` context
isolation, the extended `tenant_membership` RLS policy, and the full Gate
2 vertical journey (platform provisioning -> login -> select-tenant ->
users -> refresh rotation/reuse detection -> logout -> cross-tenant
isolation) — all require a real PostgreSQL connection and are **skipped**
(not faked) without one:

```bash
TEST_DATABASE_URL=postgres://app_rw:<app_rw_password>@localhost:5432/rewardbite \
TEST_PLATFORM_DATABASE_URL=postgres://app_platform:<app_platform_password>@localhost:5432/rewardbite \
npm run test:api:db
```

## Development servers

```bash
npm run dev:api   # NestJS on :3000 (or $PORT), GET /health, GET /api/v1/*
npm run dev:web   # Vite dev server for the React SPA — /app/login to start
```

## Tests

```bash
npm run test            # contracts + backend (non-DB) + frontend, all three workspaces
npm run test:contracts  # packages/contracts only (Vitest)
npm run test:api        # apps/api only (Jest)
npm run test:web        # apps/web only (Vitest)
npm run test:api:db     # apps/api DB integration tests (needs TEST_DATABASE_URL + TEST_PLATFORM_DATABASE_URL)
```

## Build

```bash
npm run build
```

Builds `packages/contracts` first — as **both** a CommonJS build
(`dist/cjs`, what `apps/api`/Jest/ts-jest resolve via `main`/`types`) and
an ESM build (`dist/esm`, what `apps/web`/Vite/Rollup resolve via the
`import` condition in `exports`). Rollup can't statically analyse the
barrel-file re-export pattern in a CJS bundle, so a single build served to
both consumers broke the frontend production build; dual-publishing fixed
it without changing NestJS's requirements. Then `apps/api` (`nest build`),
then `apps/web` (`tsc --noEmit` followed by `vite build`).

## Lint / format

```bash
npm run lint           # eslint . (includes the module-boundary no-restricted-imports rule)
npm run lint:fix
npm run format          # prettier --check . — this is what CI runs
npm run format:write    # prettier --write .
```

## Module boundary lint rule

`eslint.config.cjs` (repo root) enforces the backend module dependency
graph from the Implementation Blueprint (section 4) — e.g. `menu` may not
import from `orders`, no module but `platform` may import from `platform`,
and no module may import `pg` directly (only `common/db`). This is proven
automatically in
`apps/api/test/lint/module-boundaries.spec.ts`, which runs the real ESLint
engine against in-memory fixtures.

## CI

`.github/workflows/ci.yml` runs on every push/PR:

- `quality`: install, lint, format check, build, backend unit tests,
  frontend unit tests
- `database`: spins up a real Postgres service container, runs
  `db-init.sql`, runs Flyway against the empty DB, runs the RLS coverage
  check, and runs the Gate 1 + Gate 2 DB integration tests (with both
  `TEST_DATABASE_URL` and `TEST_PLATFORM_DATABASE_URL` set)

## What Gate 2 deliberately does not include

Tables, QR, sessions, menu, orders, kitchen, billing, payments, expenses,
dashboard, public ordering, printing, inventory, loyalty, WhatsApp,
delivery, subscription billing, or production deployment. Also not built
this gate: full `platform_admin` JWT authentication (`POST
/platform/auth/login`) — see `docs/IMPLEMENTATION_STATUS.md`. See the
Implementation Blueprint's gate list (section 20) for what's next.
