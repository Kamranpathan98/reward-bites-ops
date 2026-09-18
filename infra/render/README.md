# Render (API + PostgreSQL)

Reference notes only — no secrets, no runnable IaC. See the V1 Architecture
(section "Deployment") and the Implementation Blueprint (section 17) for the
full sequence. No containers/Docker are used anywhere in this deployment.

## API — Render Web Service

- Runtime: Node 22
- Build: `npm ci && npm run build`
- Start: `npm run db:migrate && node apps/api/dist/main.js`
- Health check path: `/health`
- Auto-deploy from `main`
- Env vars: see `.env.example` at the repo root; set via a Render
  environment group, never committed

## Database — Render PostgreSQL

- **Standard tier or above** — free/starter tier is explicitly unacceptable
  once any real bill exists (PITR is required)
- Daily backups + point-in-time recovery
- Two connection strings are provisioned before the first migration ever
  runs: `MIGRATION_DATABASE_URL` (`app_migrator`) and `DATABASE_URL`
  (`app_rw`) — the running API process never has DDL rights
- `scripts/db-init.sql` is run once, by a superuser, against a fresh
  database, before the first `flyway migrate`

## Not part of Sprint 1 / Gate 1

Actual Render service provisioning, staging cutover, and backup-restore
rehearsal are Gate 14 (production readiness) concerns — out of scope here.
