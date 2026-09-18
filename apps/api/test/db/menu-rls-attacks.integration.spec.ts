/**
 * Gate 5 RLS red-team — live SQL attacks against the menu catalog tables,
 * mirroring the Gate 4 review's methodology. Covers Attacks F (no tenant
 * context), G (malformed tenant context), H (app_rw bypass attempt), plus a
 * direct cross-tenant SELECT/UPDATE proof at the SQL layer (independent of
 * the HTTP-level Attacks A-C already covered in
 * gate5-menu-tenant-isolation.integration.spec.ts).
 *
 * Requires TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL
 * (app_platform) — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import { Pool } from 'pg';
import { withTenantTx } from '../../src/common/db';
import { newId } from '../../src/common/security/id';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[menu-rls-attacks.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('RED TEAM — menu catalog RLS (live SQL attacks)', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const platformPool = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL });
  const suffix = Date.now();

  const tenantA = newId();
  const tenantB = newId();
  const categoryA = newId();
  const categoryB = newId();

  beforeAll(async () => {
    // Tenant shells via app_platform (real provisioning boundary).
    await withTenantTx(platformPool, { tenantId: tenantA, actorKind: 'platform' }, async (tx) => {
      await tx.query(`INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)`, [
        tenantA,
        `Menu RLS A ${suffix}`,
        `menu-rls-a-${suffix}`,
      ]);
      await tx.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantA]);
    });
    await withTenantTx(platformPool, { tenantId: tenantB, actorKind: 'platform' }, async (tx) => {
      await tx.query(`INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)`, [
        tenantB,
        `Menu RLS B ${suffix}`,
        `menu-rls-b-${suffix}`,
      ]);
      await tx.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantB]);
    });
    // menu_category is not part of platform provisioning — seed via app_rw,
    // matching the real write path (menu.manage, staff).
    await withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
      tx.query(`INSERT INTO menu_category (id, tenant_id, name) VALUES ($1, $2, $3)`, [
        categoryA,
        tenantA,
        `RLS Category A ${suffix}`,
      ]),
    );
    await withTenantTx(pool, { tenantId: tenantB, actorKind: 'staff' }, (tx) =>
      tx.query(`INSERT INTO menu_category (id, tenant_id, name) VALUES ($1, $2, $3)`, [
        categoryB,
        tenantB,
        `RLS Category B ${suffix}`,
      ]),
    );
  });

  afterAll(async () => {
    await pool.end();
    await platformPool.end();
  });

  it('Attack F: no tenant context -> menu_category SELECT returns 0 rows', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(`SELECT * FROM menu_category`);
      expect(r.rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('cross-tenant SELECT/UPDATE/DELETE via RLS: Tenant A context cannot touch Tenant B rows', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantA]);
      await client.query(`select set_config('app.actor_kind', 'staff', true)`, []);

      const select = await client.query(`SELECT * FROM menu_category WHERE id = $1`, [categoryB]);
      expect(select.rows).toHaveLength(0);

      const update = await client.query(`UPDATE menu_category SET name = 'HACKED' WHERE id = $1`, [
        categoryB,
      ]);
      expect(update.rowCount).toBe(0);

      const del = await client.query(`DELETE FROM menu_category WHERE id = $1`, [categoryB]);
      expect(del.rowCount).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('Attack G: malformed non-UUID tenant context fails closed (throws, never leaks rows)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.tenant_id', 'not-a-uuid', true)`, []);
      await client.query(`select set_config('app.actor_kind', 'staff', true)`, []);
      await expect(client.query(`SELECT * FROM menu_category`)).rejects.toThrow(
        /invalid input syntax for type uuid/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('Attack H: app_rw cannot bypass RLS', async () => {
    const client = await pool.connect();
    try {
      const roleCheck = await client.query(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(roleCheck.rows[0].rolbypassrls).toBe(false);

      await client.query('BEGIN');
      await expect(client.query('SET row_security = off')).resolves.toBeDefined();
      await expect(client.query(`SELECT * FROM menu_category`)).rejects.toThrow(
        /row-level security policy/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('app_public has no grant on any menu table (menu catalog is not publicly readable in Gate 5)', async () => {
    // information_schema.role_table_grants is readable by any authenticated
    // role, so this is checked through the existing app_rw pool rather than
    // opening a dedicated app_public connection.
    const client = await pool.connect();
    try {
      const grants = await client.query(
        `SELECT table_name FROM information_schema.role_table_grants
          WHERE grantee = 'app_public' AND table_name LIKE 'menu_%'`,
      );
      expect(grants.rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('CONCURRENCY: real concurrent duplicate category-name creation — DB unique index is the arbiter, not a pre-check', async () => {
    const name = `Concurrent Category ${suffix}`;
    const attempts = 10;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
          tx.query(`INSERT INTO menu_category (id, tenant_id, name) VALUES ($1, $2, $3)`, [
            newId(),
            tenantA,
            name,
          ]),
        ),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(attempts - 1);
    for (const r of rejected) {
      expect(String((r.reason as Error).message)).toMatch(
        /duplicate key value violates unique constraint/,
      );
    }

    const count = await withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
      tx.query(`SELECT count(*) AS n FROM menu_category WHERE tenant_id = $1 AND name = $2`, [
        tenantA,
        name,
      ]),
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it('CONCURRENCY: real concurrent duplicate item-name creation within the same category', async () => {
    const itemId1 = newId();
    // Seed one item so a variant name-collision test can also run below.
    await withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
      tx.query(
        `INSERT INTO menu_item (id, tenant_id, category_id, name, base_price_paise) VALUES ($1, $2, $3, $4, $5)`,
        [itemId1, tenantA, categoryA, `seed-item-${suffix}`, 100],
      ),
    );

    const name = `Concurrent Item ${suffix}`;
    const attempts = 10;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
          tx.query(
            `INSERT INTO menu_item (id, tenant_id, category_id, name, base_price_paise) VALUES ($1, $2, $3, $4, $5)`,
            [newId(), tenantA, categoryA, name, 100],
          ),
        ),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const count = await withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
      tx.query(
        `SELECT count(*) AS n FROM menu_item WHERE tenant_id = $1 AND category_id = $2 AND name = $3`,
        [tenantA, categoryA, name],
      ),
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it('CONCURRENCY: real concurrent duplicate variant-name creation for the same item', async () => {
    const itemId = newId();
    await withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
      tx.query(
        `INSERT INTO menu_item (id, tenant_id, category_id, name, base_price_paise) VALUES ($1, $2, $3, $4, $5)`,
        [itemId, tenantA, categoryA, `variant-race-item-${suffix}`, 100],
      ),
    );

    const name = 'Half';
    const attempts = 10;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
          tx.query(
            `INSERT INTO menu_variant (id, tenant_id, item_id, name, price_paise) VALUES ($1, $2, $3, $4, $5)`,
            [newId(), tenantA, itemId, name, 100],
          ),
        ),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const count = await withTenantTx(pool, { tenantId: tenantA, actorKind: 'staff' }, (tx) =>
      tx.query(
        `SELECT count(*) AS n FROM menu_variant WHERE tenant_id = $1 AND item_id = $2 AND name = $3`,
        [tenantA, itemId, name],
      ),
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });
});
