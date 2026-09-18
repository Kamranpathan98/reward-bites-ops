#!/usr/bin/env node
// Thin cross-platform wrapper around `psql -f scripts/db-init.sql`.
// db-init.sql uses psql meta-commands (\set, \if) so it must be run
// through psql itself, not a plain `pg` client — this script exists so
// `npm run db:init` works the same on Windows/macOS/Linux instead of
// juggling separate shell scripts.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = path.join(__dirname, 'db-init.sql');

const {
  PGHOST = 'localhost',
  PGPORT = '5432',
  PGDATABASE,
  PGUSER = 'postgres',
  APP_MIGRATOR_PASSWORD,
  APP_RW_PASSWORD,
  APP_PUBLIC_PASSWORD,
  APP_PLATFORM_PASSWORD,
} = process.env;

if (!PGDATABASE) {
  console.error(
    'PGDATABASE is required — the target database must already exist (see docs/DEVELOPMENT.md).',
  );
  process.exit(1);
}

const args = [
  '-h',
  PGHOST,
  '-p',
  PGPORT,
  '-U',
  PGUSER,
  '-d',
  PGDATABASE,
  '-v',
  'ON_ERROR_STOP=1',
  '-f',
  sqlFile,
];

if (APP_MIGRATOR_PASSWORD) args.push('-v', `app_migrator_password=${APP_MIGRATOR_PASSWORD}`);
if (APP_RW_PASSWORD) args.push('-v', `app_rw_password=${APP_RW_PASSWORD}`);
if (APP_PUBLIC_PASSWORD) args.push('-v', `app_public_password=${APP_PUBLIC_PASSWORD}`);
if (APP_PLATFORM_PASSWORD) args.push('-v', `app_platform_password=${APP_PLATFORM_PASSWORD}`);

console.log(`Running scripts/db-init.sql against ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE} ...`);

const result = spawnSync('psql', args, {
  stdio: 'inherit',
  env: process.env, // PGPASSWORD (superuser password) flows through if set
});

if (result.error) {
  console.error(
    'Failed to run psql. Is the PostgreSQL client (psql) installed and on PATH?',
    result.error.message,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
