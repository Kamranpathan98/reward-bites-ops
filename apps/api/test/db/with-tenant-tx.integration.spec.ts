/**
 * Real-PostgreSQL integration test proving tenant context set by
 * `withTenantTx()` does not leak between pooled transactions.
 *
 * Requires a real, reachable PostgreSQL database — see
 * docs/DEVELOPMENT.md, "Running the tenant-context integration test".
 * This suite is skipped (not faked) if TEST_DATABASE_URL is unset.
 */
import { Pool } from 'pg';
import { withTenantTx } from '../../src/common/db/with-tenant-tx';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.warn(
    '[with-tenant-tx.integration.spec] SKIPPED — TEST_DATABASE_URL is not set. ' +
      'See docs/DEVELOPMENT.md for how to run this against a real local Postgres.',
  );
}

describeIfDb('withTenantTx — tenant context does not leak across a pooled connection', () => {
  // max: 1 forces both transactions in this test onto the exact same
  // underlying socket, which is the only way to actually prove non-leakage.
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });

  afterAll(async () => {
    await pool.end();
  });

  it('does not carry tenant-A context into a later transaction on the same connection', async () => {
    // Transaction A: set tenant-A, read it back, commit.
    await withTenantTx(pool, { tenantId: 'tenant-A', actorKind: 'system' }, async (tx) => {
      const result = await tx.query<{ tid: string }>(
        `select current_setting('app.tenant_id', true) as tid`,
      );
      expect(result.rows[0]?.tid).toBe('tenant-A');
    });

    // Probe: a fresh transaction on the same pooled connection (max: 1
    // guarantees reuse) must see no leftover tenant context at all.
    //
    // Discovered by actually running this against a real Postgres instance:
    // once a custom ("app.*") GUC has been referenced at all in a session,
    // Postgres keeps a placeholder for it — a later `current_setting(name,
    // true)`, after the SET LOCAL that created it has committed, returns
    // '' (empty string), not NULL. NULL is only returned when the name has
    // never been touched in the session at all. This is still safe: RLS
    // policies (db/migrations/R__rls_policies.sql) cast via
    // `nullif(current_setting(...), '')::uuid`, so '' is treated exactly
    // like "no tenant context" — it can never match a real tenant_id.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const probe = await client.query<{ tid: string | null }>(
        `select current_setting('app.tenant_id', true) as tid`,
      );
      expect(probe.rows[0]?.tid).not.toBe('tenant-A');
      expect(probe.rows[0]?.tid).toBe('');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Transaction B: explicitly set tenant-B on the same connection.
    await withTenantTx(pool, { tenantId: 'tenant-B', actorKind: 'system' }, async (tx) => {
      const result = await tx.query<{ tid: string }>(
        `select current_setting('app.tenant_id', true) as tid`,
      );
      expect(result.rows[0]?.tid).toBe('tenant-B');
      expect(result.rows[0]?.tid).not.toBe('tenant-A');
    });
  });

  it('rolls back and releases the connection cleanly when the callback throws', async () => {
    await expect(
      withTenantTx(pool, { tenantId: 'tenant-A', actorKind: 'system' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The pool must still be usable afterwards — release(err) discarded the
    // broken connection and the pool opened a fresh one.
    await withTenantTx(pool, { tenantId: 'tenant-B', actorKind: 'system' }, async (tx) => {
      const result = await tx.query<{ tid: string }>(
        `select current_setting('app.tenant_id', true) as tid`,
      );
      expect(result.rows[0]?.tid).toBe('tenant-B');
    });
  });
});
