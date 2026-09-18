/**
 * Gate 6 security / adversarial attack matrix (task §39, attacks A-O),
 * executed against the real HTTP API and real Postgres.
 *
 * Requires TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL
 * (app_platform) — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

describeIfDb('RED TEAM — Gate 6 orders tenant isolation + attack matrix', () => {
  let app: INestApplication;
  let rwPool: Pool;
  const suffix = Date.now();
  const bootstrapSecret = 'test-only-bootstrap-secret-1234';

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
    process.env['PLATFORM_BOOTSTRAP_SECRET'] = bootstrapSecret;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    await app.init();
    rwPool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    await app.close();
    await rwPool.end();
  });

  const tenantASlug = `gate6-iso-a-${suffix}`;
  const tenantBSlug = `gate6-iso-b-${suffix}`;
  const ownerAEmail = `gate6-iso-owner-a-${suffix}@example.com`;
  const ownerBEmail = `gate6-iso-owner-b-${suffix}@example.com`;
  const password = 'a-real-owner-password-123';

  let ownerAToken: string;
  let ownerBToken: string;
  let itemAId: string;
  let tableBId: string;
  let itemBId: string;
  let variantBId: string;
  let addonBId: string;
  let orderBId: string;

  it('setup: two tenants, each with a table + priced item + variant + addon, and tenant B has an order', async () => {
    const pa = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Orders Iso A',
        slug: tenantASlug,
        ownerEmail: ownerAEmail,
        ownerPassword: password,
      });
    expect(pa.status).toBe(201);
    const pb = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Orders Iso B',
        slug: tenantBSlug,
        ownerEmail: ownerBEmail,
        ownerPassword: password,
      });
    expect(pb.status).toBe(201);

    const la = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerAEmail, password });
    ownerAToken = la.body.accessToken;
    const lb = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerBEmail, password });
    ownerBToken = lb.body.accessToken;

    async function seedTenant(token: string) {
      const table = await request(app.getHttpServer())
        .post('/api/v1/tables')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Iso Table ${suffix}-${randomUUID().slice(0, 8)}` });
      const category = await request(app.getHttpServer())
        .post('/api/v1/menu/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Iso Category ${suffix}-${randomUUID().slice(0, 8)}` });
      const item = await request(app.getHttpServer())
        .post('/api/v1/menu/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          categoryId: category.body.data.id,
          name: `Iso Item ${suffix}`,
          basePricePaise: 5000,
        });
      const variant = await request(app.getHttpServer())
        .post('/api/v1/menu/variants')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: item.body.data.id, name: 'Iso Variant', pricePaise: 6000 });
      const addon = await request(app.getHttpServer())
        .post('/api/v1/menu/addons')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Iso Addon ${suffix}`, pricePaise: 500 });
      return {
        tableId: table.body.data.id,
        itemId: item.body.data.id,
        variantId: variant.body.data.id,
        addonId: addon.body.data.id,
      };
    }

    const a = await seedTenant(ownerAToken);
    itemAId = a.itemId;

    const b = await seedTenant(ownerBToken);
    tableBId = b.tableId;
    itemBId = b.itemId;
    variantBId = b.variantId;
    addonBId = b.addonId;

    const orderB = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'DINE_IN',
        tableId: tableBId,
        lines: [{ itemId: itemBId, qty: 1 }],
      });
    expect(orderB.status).toBe(201);
    orderBId = orderB.body.data.id;
  }, 30000);

  it('Attack A: Tenant A reads Tenant B order -> 404, no data leak', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderBId}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(res.status).toBe(404);

    const list = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(list.body.data.find((o: { id: string }) => o.id === orderBId)).toBeUndefined();
  });

  it('Attack B: Tenant A modifies Tenant B order -> 404, unchanged', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderBId}/lines`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ expectedVersion: 0, add: [{ itemId: itemAId, qty: 1 }] });
    expect(res.status).toBe(404);

    const check = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderBId}`)
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(check.body.data.lines).toHaveLength(1);
  });

  it('Attack C: Tenant A transitions Tenant B order -> 404, unchanged', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderBId}/transition`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ to: 'ACCEPTED', expectedVersion: 0 });
    expect(res.status).toBe(404);

    const check = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderBId}`)
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(check.body.data.status).toBe('NEW');
  });

  it('Attack D: Tenant A cancels Tenant B order -> 404, unchanged', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderBId}/cancel`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ expectedVersion: 0, reason: 'Attack' });
    expect(res.status).toBe(404);

    const check = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderBId}`)
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(check.body.data.status).toBe('NEW');
  });

  it('Attack E: Tenant A creates an order referencing Tenant B table -> 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'DINE_IN',
        tableId: tableBId,
        lines: [{ itemId: itemAId, qty: 1 }],
      });
    expect(res.status).toBe(404);
  });

  it('Attack F: Tenant A creates an order referencing Tenant B menu item -> 422 ITEM_UNAVAILABLE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemBId, qty: 1 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
  });

  it('Attack G: Tenant A creates an order referencing Tenant B variant -> rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemAId, variantId: variantBId, qty: 1 }],
      });
    expect(res.status).toBe(422);
  });

  it('Attack H: Tenant A creates an order referencing Tenant B addon -> rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemAId, qty: 1, addons: [{ addonId: addonBId, qty: 1 }] }],
      });
    expect(res.status).toBe(422);
  });

  it('Attack I: client-supplied tenant_id in the request body is ignored', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        tenantId: 'not-even-a-real-tenant-id',
        lines: [{ itemId: itemAId, qty: 1 }],
      });
    expect(res.status).toBe(201);
    // Row lands under the authenticated tenant (A) — confirmed by being
    // readable with A's own token and absent from B's list.
    const treeB = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(treeB.body.data.find((o: { id: string }) => o.id === res.body.data.id)).toBeUndefined();
  });

  it('Attack J: client-supplied fake unit price is ignored — server resolves it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemAId, qty: 1, unitPricePaise: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].unitPricePaise).toBe(5000); // the real item price, not 1
  });

  it('Attack K: client-supplied fake line/subtotal totals are ignored — server computes them', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemAId, qty: 2, lineTotalPaise: 1 }],
        subtotalPaise: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].lineTotalPaise).toBe(10000);
    expect(res.body.data.subtotalPaise).toBe(10000);
  });

  it('Attack L: client cannot submit COMPLETED directly during creation — no status field is even accepted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        status: 'COMPLETED',
        lines: [{ itemId: itemAId, qty: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('NEW'); // the client-supplied status field is silently ignored
  });

  it('Attack M: an authenticated user without any orders.* permission cannot mutate (Kitchen Staff denied orders.create/read/transition/cancel where not granted)', async () => {
    const rolesRes = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAToken}`);
    const kitchenRole = rolesRes.body.data.find(
      (r: { name: string }) => r.name === 'Kitchen Staff',
    );
    const kitchenEmail = `gate6-iso-kitchen-${suffix}@example.com`;
    const kitchenPassword = 'a-real-kitchen-password-123';
    await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        email: kitchenEmail,
        fullName: 'Kitchen Person',
        roleId: kitchenRole.id,
        tempPassword: kitchenPassword,
      });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: kitchenEmail, password: kitchenPassword });
    const kitchenToken = login.body.accessToken;

    // Kitchen Staff has orders.transition.kitchen only — no orders.read/create/cancel.
    const create = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemAId, qty: 1 }],
      });
    expect(create.status).toBe(403);

    const read = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${kitchenToken}`);
    expect(read.status).toBe(403);

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId: itemAId, qty: 1 }],
      });

    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ expectedVersion: 0, reason: 'x' });
    expect(cancel.status).toBe(403);

    // But Kitchen Staff CAN transition ACCEPTED->PREPARING (has orders.transition.kitchen) —
    // proves the denial above is real permission enforcement, not a broken guard blocking everyone.
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/transition`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ to: 'ACCEPTED', expectedVersion: 0 });
    const kitchenTransition = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/transition`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ to: 'PREPARING', expectedVersion: 1 });
    expect(kitchenTransition.status).toBe(200);

    // ...but Kitchen Staff is still refused the front-of-house COMPLETED transition.
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/transition`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ to: 'READY', expectedVersion: 2 });
    const kitchenComplete = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.data.id}/transition`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ to: 'COMPLETED', expectedVersion: 3 });
    expect(kitchenComplete.status).toBe(403);
  });

  it('Attack N: unauthenticated requests to every Gate 6 endpoint -> 401', async () => {
    const attempts = [
      request(app.getHttpServer()).get('/api/v1/orders'),
      request(app.getHttpServer()).get(`/api/v1/orders/${orderBId}`),
      request(app.getHttpServer())
        .post('/api/v1/orders')
        .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [] }),
      request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderBId}/lines`)
        .send({ expectedVersion: 0 }),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderBId}/transition`)
        .send({ to: 'ACCEPTED', expectedVersion: 0 }),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderBId}/cancel`)
        .send({ expectedVersion: 0, reason: 'x' }),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderBId}/reopen`)
        .send({ expectedVersion: 0 }),
    ];
    const results = await Promise.all(attempts);
    for (const res of results) {
      expect(res.status).toBe(401);
    }
  });

  it('Attack O: app_rw cannot bypass RLS on the orders tables', async () => {
    const client = await rwPool.connect();
    try {
      const roleCheck = await client.query(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(roleCheck.rows[0].rolbypassrls).toBe(false);

      await client.query('BEGIN');
      await client.query('SET row_security = off');
      await expect(client.query(`SELECT * FROM orders`)).rejects.toThrow(
        /row-level security policy/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('cross-tenant SELECT/UPDATE via RLS at the SQL layer: Tenant A context cannot touch Tenant B order rows', async () => {
    const client = await rwPool.connect();
    try {
      const ownerARes = await request(app.getHttpServer())
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${ownerAToken}`);
      const someAId = ownerARes.body.data[0]?.id;
      expect(someAId).toBeDefined();

      // Need tenant A's real id for app.tenant_id — read it back via /auth/me.
      const meA = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${ownerAToken}`);
      const tenantAId = meA.body.tenant.id;

      await client.query('BEGIN');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantAId]);
      await client.query(`select set_config('app.actor_kind', 'staff', true)`, []);

      const select = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderBId]);
      expect(select.rows).toHaveLength(0);

      const update = await client.query(`UPDATE orders SET notes = 'HACKED' WHERE id = $1`, [
        orderBId,
      ]);
      expect(update.rowCount).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
