/**
 * Gate 4 exit criterion (blueprint row 372 / Gate 4 row 790): "one open
 * session per table enforced under load." Proves the partial unique index
 * `table_session_tenant_table_open_unique` — not any application-level
 * check-then-insert, which would itself race — is what arbitrates two
 * simultaneous attempts to open a session for the same table.
 *
 * Requires TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL
 * (app_platform) — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import { Pool } from 'pg';
import { isUniqueViolation, withTenantTx } from '../../src/common/db';
import { generateOpaqueToken } from '../../src/common/security/opaque-token';
import { newId } from '../../src/common/security/id';
import { TableSessionRepository } from '../../src/modules/tables/table-session.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[table-session-race.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('table_session — one OPEN session per table under concurrency', () => {
  // A real pool with several connections, so concurrent opens genuinely
  // overlap in Postgres rather than being serialized by a max:1 pool.
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  const platformPool = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL, max: 2 });
  const sessionRepository = new TableSessionRepository();
  const suffix = Date.now();

  const tenantId = newId();
  const tableId = newId();

  beforeAll(async () => {
    // Tenant shell via app_platform (real provisioning boundary). The
    // table itself is NOT part of platform provisioning — a fresh tenant
    // starts with zero tables; staff create them via app_rw (tables.manage)
    // — app_platform correctly has no grant on restaurant_table at all.
    await withTenantTx(platformPool, { tenantId, actorKind: 'platform' }, async (tx) => {
      await tx.query(`INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)`, [
        tenantId,
        `Race Test Tenant ${suffix}`,
        `race-test-${suffix}`,
      ]);
      await tx.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantId]);
    });
    await withTenantTx(pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      await tx.query(`INSERT INTO restaurant_table (id, tenant_id, name) VALUES ($1, $2, $3)`, [
        tableId,
        tenantId,
        `Race Table ${suffix}`,
      ]);
    });
  });

  afterAll(async () => {
    await pool.end();
    await platformPool.end();
  });

  it('20 concurrent session-open attempts on the same table: exactly one wins', async () => {
    const attempts = 20;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        withTenantTx(pool, { tenantId, actorKind: 'staff' }, (tx) =>
          sessionRepository.openForTable(tx, {
            tenantId,
            tableId,
            sessionToken: generateOpaqueToken(),
            openedByUserId: null,
          }),
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(attempts - 1);
    for (const r of rejected) {
      expect(isUniqueViolation(r.reason, 'table_session_tenant_table_open_unique')).toBe(true);
    }

    const openCount = await withTenantTx(pool, { tenantId, actorKind: 'staff' }, (tx) =>
      tx.query(`SELECT count(*) AS n FROM table_session WHERE tenant_id = $1 AND status = 'OPEN'`, [
        tenantId,
      ]),
    );
    expect(Number(openCount.rows[0].n)).toBe(1);
  });
});
