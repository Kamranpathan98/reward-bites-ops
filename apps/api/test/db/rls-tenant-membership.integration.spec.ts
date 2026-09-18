/**
 * Proves the extended RLS policy on `tenant_membership`
 * (db/migrations/R__rls_policies.sql) does exactly what it's meant to:
 *
 *   - a tenant-scoped read (app.tenant_id set) sees only that tenant's rows
 *   - a global read scoped by app.user_id (app.tenant_id unset) sees only
 *     THAT user's own membership rows, across every tenant they belong to
 *   - it never leaks another user's membership rows in a tenant context
 *     that isn't theirs, and never leaks cross-tenant data through the
 *     user_id clause
 *
 * Requires a real PostgreSQL database with Gate 1 + Gate 2 migrations
 * applied — see docs/DEVELOPMENT.md. Skipped (not faked) without one.
 */
import { Pool } from 'pg';
import { withGlobalTx } from '../../src/common/db/with-global-tx';
import { withTenantTx } from '../../src/common/db/with-tenant-tx';
import { newId } from '../../src/common/security/id';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[rls-tenant-membership.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('tenant_membership RLS (own-tenant OR own-user_id)', () => {
  // Seeding runs through the actual app_platform role, not app_rw: app_rw
  // only has SELECT on `tenant`/`role`/`user` (Gate 2's R__grants.sql), so
  // inserting the seed rows through it fails with "permission denied" no
  // matter what actor_kind is set to — RLS policies only restrict which
  // rows an already-granted operation can touch, they don't grant the
  // operation itself. Discovered by actually running this against a real
  // database. The RLS assertions below still read through `pool` (app_rw),
  // which is the thing under test.
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const platformPool = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL });
  const suffix = Date.now();

  const tenantAId = newId();
  const tenantBId = newId();
  const roleAId = newId();
  const roleBId = newId();
  const userXId = newId(); // belongs to tenant A only
  const userYId = newId(); // belongs to tenant B only
  let membershipXInA: string;
  let membershipYInB: string;

  beforeAll(async () => {
    // Seed directly as app_migrator-equivalent via a superuser-ish setup
    // is out of scope here; instead seed through withTenantTx as
    // 'platform' actor, matching how PlatformService really creates rows,
    // to avoid re-deriving bootstrap SQL in a test.
    await withTenantTx(platformPool, { tenantId: tenantAId, actorKind: 'platform' }, async (tx) => {
      await tx.query(`INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)`, [
        tenantAId,
        `RLS Test Tenant A ${suffix}`,
        `rls-test-a-${suffix}`,
      ]);
      await tx.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantAId]);
      await tx.query(
        `INSERT INTO role (id, tenant_id, name, is_system) VALUES ($1, $2, 'Owner', true)`,
        [roleAId, tenantAId],
      );
      await tx.query(
        `INSERT INTO "user" (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'User X')`,
        [userXId, `user-x-${suffix}@example.com`],
      );
      const result = await tx.query<{ id: string }>(
        `INSERT INTO tenant_membership (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [newId(), tenantAId, userXId, roleAId],
      );
      membershipXInA = result.rows[0]?.id as string;
    });

    await withTenantTx(platformPool, { tenantId: tenantBId, actorKind: 'platform' }, async (tx) => {
      await tx.query(`INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)`, [
        tenantBId,
        `RLS Test Tenant B ${suffix}`,
        `rls-test-b-${suffix}`,
      ]);
      await tx.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantBId]);
      await tx.query(
        `INSERT INTO role (id, tenant_id, name, is_system) VALUES ($1, $2, 'Owner', true)`,
        [roleBId, tenantBId],
      );
      await tx.query(
        `INSERT INTO "user" (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'User Y')`,
        [userYId, `user-y-${suffix}@example.com`],
      );
      const result = await tx.query<{ id: string }>(
        `INSERT INTO tenant_membership (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [newId(), tenantBId, userYId, roleBId],
      );
      membershipYInB = result.rows[0]?.id as string;
    });
  });

  afterAll(async () => {
    await pool.end();
    await platformPool.end();
  });

  it('a tenant-scoped read sees only that tenant membership row', async () => {
    const rows = await withTenantTx(pool, { tenantId: tenantAId, actorKind: 'staff' }, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM tenant_membership WHERE id = $1`, [membershipXInA]),
    );
    expect(rows.rows).toHaveLength(1);

    const crossTenantRows = await withTenantTx(
      pool,
      { tenantId: tenantBId, actorKind: 'staff' },
      (tx) =>
        tx.query<{ id: string }>(`SELECT id FROM tenant_membership WHERE id = $1`, [
          membershipXInA,
        ]),
    );
    expect(crossTenantRows.rows).toHaveLength(0);
  });

  it("a global (no-tenant) read scoped by app.user_id sees exactly that user's own membership", async () => {
    const ownRows = await withGlobalTx(pool, { userId: userXId, actorKind: 'staff' }, (tx) =>
      tx.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM tenant_membership WHERE user_id = $1`,
        [userXId],
      ),
    );
    expect(ownRows.rows).toHaveLength(1);
    expect(ownRows.rows[0]?.id).toBe(membershipXInA);
    expect(ownRows.rows[0]?.tenant_id).toBe(tenantAId);
  });

  it("a global read never returns a DIFFERENT user's membership row, even by direct id lookup", async () => {
    const result = await withGlobalTx(pool, { userId: userXId, actorKind: 'staff' }, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM tenant_membership WHERE id = $1`, [membershipYInB]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it('an unset app.user_id (no context at all) sees nothing via the user_id clause either', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `SELECT id FROM tenant_membership WHERE id = $1`,
        [membershipXInA],
      );
      expect(result.rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
