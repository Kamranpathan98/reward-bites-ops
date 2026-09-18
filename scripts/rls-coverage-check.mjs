#!/usr/bin/env node
// CI + local job: applies the architecture's own RLS coverage rule
// (architecture section 6, point 11 / blueprint section 5, stage 10 note):
// every table with a tenant_id column must have RLS enabled, forced, and
// at least one policy; app_rw must never be able to bypass RLS.
//
// At Sprint 1 there are zero tenant tables, so this is expected to report
// zero violations — that is what "passes vacuously" means, not that the
// check is skipped.
import pg from 'pg';

const { Client } = pg;

const connectionString =
  process.env.RLS_CHECK_DATABASE_URL ||
  process.env.MIGRATION_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  console.error('RLS_CHECK_DATABASE_URL (or MIGRATION_DATABASE_URL / DATABASE_URL) must be set.');
  process.exit(1);
}

const client = new Client({ connectionString });

const TENANT_TABLE_COVERAGE_QUERY = `
  WITH tenant_tables AS (
    SELECT DISTINCT
      c.oid,
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relrowsecurity,
      c.relforcerowsecurity
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relkind = 'r'
      AND n.nspname = 'public'
  )
  SELECT
    tt.table_name,
    tt.relrowsecurity AS rls_enabled,
    tt.relforcerowsecurity AS rls_forced,
    count(p.policyname) AS policy_count
  FROM tenant_tables tt
  LEFT JOIN pg_policies p
    ON p.schemaname = tt.schema_name AND p.tablename = tt.table_name
  GROUP BY tt.table_name, tt.relrowsecurity, tt.relforcerowsecurity
  ORDER BY tt.table_name;
`;

const BYPASS_RLS_QUERY = `
  SELECT rolname, rolbypassrls
  FROM pg_roles
  WHERE rolname IN ('app_rw', 'app_public', 'app_platform')
  ORDER BY rolname;
`;

async function main() {
  await client.connect();

  const violations = [];

  const { rows: tenantTables } = await client.query(TENANT_TABLE_COVERAGE_QUERY);
  for (const row of tenantTables) {
    if (!row.rls_enabled) violations.push(`${row.table_name}: RLS not ENABLED`);
    if (!row.rls_forced) violations.push(`${row.table_name}: RLS not FORCED`);
    if (Number(row.policy_count) === 0) violations.push(`${row.table_name}: no RLS policy`);
  }

  const { rows: roles } = await client.query(BYPASS_RLS_QUERY);
  for (const role of roles) {
    if (role.rolbypassrls) violations.push(`role ${role.rolname}: BYPASSRLS is true`);
  }

  console.log(`Tenant tables scanned: ${tenantTables.length}`);
  console.log(
    `Roles checked for BYPASSRLS: ${roles.map((r) => r.rolname).join(', ') || '(none found)'}`,
  );

  if (violations.length > 0) {
    console.error('\nRLS coverage check FAILED:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exitCode = 1;
  } else {
    console.log('\nRLS coverage check passed (0 violations).');
  }

  await client.end();
}

main().catch((err) => {
  console.error('RLS coverage check errored:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
