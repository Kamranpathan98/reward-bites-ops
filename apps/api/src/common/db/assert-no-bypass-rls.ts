import type { Pool } from 'pg';

/**
 * Startup security check (blueprint section 16 / architecture section 6.5).
 *
 * If `app_rw` can bypass RLS, tenant isolation is silently disabled —
 * refuse to start rather than attempt any repair.
 */
export async function assertNoBypassRls(pool: Pool): Promise<void> {
  const result = await pool.query<{ rolbypassrls: boolean }>(
    `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_rw'`,
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Startup security check failed: role 'app_rw' does not exist. " +
        'Run scripts/db-init.sql against the target database before starting the API.',
    );
  }

  if (row.rolbypassrls) {
    throw new Error(
      "Startup security check failed: role 'app_rw' has BYPASSRLS. " +
        'Refusing to start — this would silently disable tenant isolation. ' +
        'Fix with: ALTER ROLE app_rw NOBYPASSRLS; (this check will not do it for you).',
    );
  }
}
