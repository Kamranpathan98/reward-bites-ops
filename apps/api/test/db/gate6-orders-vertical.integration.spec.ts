/**
 * Gate 6 (Orders) vertical journey, end to end, against the real NestJS
 * app and a real PostgreSQL database — order creation (DINE_IN opening a
 * new table session, TAKEAWAY opening a table-less session), line
 * pricing/snapshotting, editing, the full state machine (both KITCHEN and
 * SIMPLE workflow modes), cancellation, and reopen.
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
import { withTenantTx } from '../../src/common/db';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[gate6-orders-vertical.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('Gate 6 vertical journey — orders (real API + real Postgres)', () => {
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

  const ownerEmail = `gate6-owner-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';
  let ownerToken: string;
  let tenantId: string;
  let tableId: string;
  let categoryId: string;
  let itemId: string; // has a base price, no variants
  let variantItemId: string; // variant-only item
  let halfVariantId: string;
  let addonId: string;

  it('setup: tenant, owner, table, and a menu with an item (+addon) and a variant-only item', async () => {
    const provision = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({ name: 'Gate 6 Journey', slug: `gate6-journey-${suffix}`, ownerEmail, ownerPassword });
    expect(provision.status).toBe(201);
    tenantId = provision.body.data.tenantId;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    ownerToken = login.body.accessToken;

    const table = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Table ${suffix}` });
    tableId = table.body.data.id;

    const category = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Mains ${suffix}` });
    categoryId = category.body.data.id;

    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Chicken Noodles ${suffix}`, basePricePaise: 18000 });
    itemId = item.body.data.id;

    const addon = await request(app.getHttpServer())
      .post('/api/v1/menu/addons')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Extra Spicy ${suffix}`, pricePaise: 1000 });
    addonId = addon.body.data.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ addons: [{ addonId, maxQty: 3 }] });

    const variantItem = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Fried Rice ${suffix}` });
    variantItemId = variantItem.body.data.id;
    const variant = await request(app.getHttpServer())
      .post('/api/v1/menu/variants')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ itemId: variantItemId, name: 'Half', pricePaise: 12000 });
    halfVariantId = variant.body.data.id;
  }, 20000);

  let orderId: string;

  it('creates a DINE_IN order against a table with no existing session (opens one)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'DINE_IN',
        tableId,
        lines: [
          { itemId, qty: 2, addons: [{ addonId, qty: 1 }] },
          { itemId: variantItemId, variantId: halfVariantId, qty: 1 },
        ],
      });
    expect(res.status).toBe(201);
    const order = res.body.data;
    orderId = order.id;

    expect(order.status).toBe('NEW');
    expect(order.source).toBe('COUNTER');
    expect(order.type).toBe('DINE_IN');
    expect(order.orderNumber).toMatch(/^#\d{4}$/);
    expect(order.version).toBe(0);
    expect(order.lines).toHaveLength(2);

    const line1 = order.lines.find((l: { menuItemId: string }) => l.menuItemId === itemId);
    // 2 * 18000 + 1 * 1000 (addon) = 37000
    expect(line1.unitPricePaise).toBe(18000);
    expect(line1.qty).toBe(2);
    expect(line1.lineTotalPaise).toBe(37000);
    expect(line1.addons).toHaveLength(1);
    expect(line1.addons[0].unitPricePaise).toBe(1000);

    const line2 = order.lines.find((l: { menuItemId: string }) => l.menuItemId === variantItemId);
    expect(line2.unitPricePaise).toBe(12000);
    expect(line2.variantNameSnapshot).toBe('Half');
    expect(line2.lineTotalPaise).toBe(12000);

    // subtotal = 37000 + 12000 = 49000 (trigger-computed, verified via the API not raw SQL)
    expect(order.subtotalPaise).toBe(49000);
    expect(order.lineCount).toBe(2);

    expect(order.history).toHaveLength(1);
    expect(order.history[0].toStatus).toBe('NEW');
    expect(order.history[0].fromStatus).toBeNull();
  });

  it('GET /orders/:id returns the same order', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderId);
  });

  it('GET /orders lists it, filterable by status and sessionId', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((o: { id: string }) => o.id === orderId)).toBe(true);

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .query({ status: 'NEW' })
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.some((o: { id: string }) => o.id === orderId)).toBe(true);

    const wrongStatus = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .query({ status: 'COMPLETED' })
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(wrongStatus.status).toBe(200);
    expect(wrongStatus.body.data.some((o: { id: string }) => o.id === orderId)).toBe(false);
  });

  it('a second DINE_IN order on the same table reuses the same open session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'DINE_IN',
        tableId,
        lines: [{ itemId, qty: 1 }],
      });
    expect(res.status).toBe(201);

    const first = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.data.tableSessionId).toBe(first.body.data.tableSessionId);
  });

  it('a TAKEAWAY order needs no table and gets its own session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('TAKEAWAY');
  });

  it('rejects DINE_IN without a tableId, and TAKEAWAY with one', async () => {
    const noTable = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'DINE_IN', lines: [{ itemId, qty: 1 }] });
    expect(noTable.status).toBe(422);

    const withTable = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        tableId,
        lines: [{ itemId, qty: 1 }],
      });
    expect(withTable.status).toBe(422);
  });

  it('rejects an unavailable item with 422 ITEM_UNAVAILABLE', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}/availability`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isAvailable: false });

    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}/availability`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isAvailable: true });
  });

  it('edits lines on the NEW order: add, update qty, remove', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const targetLine = before.body.data.lines.find(
      (l: { menuItemId: string }) => l.menuItemId === variantItemId,
    );

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/lines`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        expectedVersion: before.body.data.version,
        add: [{ itemId, qty: 1 }],
        update: [{ lineId: targetLine.id, qty: 3 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(before.body.data.version + 1);
    expect(res.body.data.lines).toHaveLength(3);
    const updated = res.body.data.lines.find((l: { id: string }) => l.id === targetLine.id);
    expect(updated.qty).toBe(3);
    expect(updated.lineTotalPaise).toBe(12000 * 3);

    const removeRes = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/lines`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: res.body.data.version, remove: [targetLine.id] });
    expect(removeRes.status).toBe(200);
    const removedLine = removeRes.body.data.lines.find(
      (l: { id: string }) => l.id === targetLine.id,
    );
    expect(removedLine.status).toBe('REMOVED');
  });

  it('rejects an edit with a stale expectedVersion', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/lines`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 0, add: [{ itemId, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('walks the full KITCHEN-mode state machine: NEW -> ACCEPTED -> PREPARING -> READY -> COMPLETED', async () => {
    const current = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    let version = current.body.data.version;

    const toAccepted = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'ACCEPTED', expectedVersion: version });
    expect(toAccepted.status).toBe(200);
    expect(toAccepted.body.data.status).toBe('ACCEPTED');
    expect(toAccepted.body.data.acceptedAt).not.toBeNull();
    version = toAccepted.body.data.version;

    const toPreparing = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'PREPARING', expectedVersion: version });
    expect(toPreparing.status).toBe(200);
    version = toPreparing.body.data.version;

    const toReady = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'READY', expectedVersion: version });
    expect(toReady.status).toBe(200);
    expect(toReady.body.data.readyAt).not.toBeNull();
    version = toReady.body.data.version;

    const toCompleted = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'COMPLETED', expectedVersion: version });
    expect(toCompleted.status).toBe(200);
    expect(toCompleted.body.data.completedAt).not.toBeNull();

    const history = toCompleted.body.data.history.map((h: { toStatus: string }) => h.toStatus);
    expect(history).toEqual(['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']);
  });

  it('rejects invalid transitions: NEW -> COMPLETED is refused in KITCHEN mode, COMPLETED -> anything is terminal', async () => {
    // `tenant_settings.orders_workflow` defaults to SIMPLE (Gate 3's own
    // migration), so KITCHEN mode is set explicitly here to exercise the
    // shortcut-refusal path specifically.
    await withTenantTx(rwPool, { tenantId, actorKind: 'staff' }, (tx) =>
      tx.query(`UPDATE tenant_settings SET orders_workflow = 'KITCHEN' WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );

    const fresh = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    const freshId = fresh.body.data.id;

    const shortcut = await request(app.getHttpServer())
      .post(`/api/v1/orders/${freshId}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'COMPLETED', expectedVersion: 0 });
    expect(shortcut.status).toBe(409);
    expect(shortcut.body.error.code).toBe('INVALID_TRANSITION');

    // A terminal (COMPLETED) order from the previous test can't transition further.
    const terminal = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'ACCEPTED', expectedVersion: 99 });
    expect(terminal.status).toBe(409);
  });

  it('SIMPLE workflow mode allows the NEW -> COMPLETED shortcut', async () => {
    // No `PATCH /settings` endpoint exists yet (not part of any gate
    // through Gate 6) — flip `tenant_settings.orders_workflow` directly,
    // the same way earlier gates seeded state with no HTTP path yet.
    await withTenantTx(rwPool, { tenantId, actorKind: 'staff' }, (tx) =>
      tx.query(`UPDATE tenant_settings SET orders_workflow = 'SIMPLE' WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );

    const fresh = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    expect(fresh.status).toBe(201);

    const shortcut = await request(app.getHttpServer())
      .post(`/api/v1/orders/${fresh.body.data.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'COMPLETED', expectedVersion: 0 });
    expect(shortcut.status).toBe(200);
    expect(shortcut.body.data.status).toBe('COMPLETED');

    await withTenantTx(rwPool, { tenantId, actorKind: 'staff' }, (tx) =>
      tx.query(`UPDATE tenant_settings SET orders_workflow = 'KITCHEN' WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );
  });

  it('reopens a COMPLETED order back to ACCEPTED', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(before.body.data.status).toBe('COMPLETED');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/reopen`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: before.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACCEPTED');
  });

  it('cancels an order with a reason, and rejects cancelling an already-cancelled order', async () => {
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    const freshId = fresh.body.data.id;

    const missingReason = await request(app.getHttpServer())
      .post(`/api/v1/orders/${freshId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 0 });
    expect(missingReason.status).toBe(400);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${freshId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 0, reason: 'Customer changed their mind' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.cancelReason).toBe('Customer changed their mind');

    const again = await request(app.getHttpServer())
      .post(`/api/v1/orders/${freshId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: res.body.data.version, reason: 'Again' });
    expect(again.status).toBe(409);
  });
});
