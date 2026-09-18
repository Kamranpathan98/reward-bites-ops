/**
 * Gate 6 price-snapshot immutability matrix (task instruction §37) — every
 * scenario actually run against real Postgres, not asserted by inspection:
 * once an order line is created, later menu mutations (price change, rename,
 * addon removal, deactivation) must never alter what an existing order
 * already shows.
 *
 * Requires TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL
 * (app_platform) — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

describeIfDb('Gate 6 — price snapshot immutability (real API + real Postgres)', () => {
  let app: INestApplication;
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
  });

  afterAll(async () => {
    await app.close();
  });

  const ownerEmail = `gate6-snap-owner-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';
  let ownerToken: string;
  let categoryId: string;

  beforeAll(async () => {
    const provision = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({ name: 'Gate 6 Snapshot', slug: `gate6-snap-${suffix}`, ownerEmail, ownerPassword });
    expect(provision.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    ownerToken = login.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Snap Category ${suffix}` });
    categoryId = category.body.data.id;
  }, 20000);

  it('Test 1: item price change after order creation does not change the existing order', async () => {
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Snap Item 1 ${suffix}`, basePricePaise: 10000 });
    const itemId = item.body.data.id;

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    expect(order.status).toBe(201);
    expect(order.body.data.lines[0].unitPricePaise).toBe(10000);

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ basePricePaise: 15000 });

    const reread = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reread.body.data.lines[0].unitPricePaise).toBe(10000);
    expect(reread.body.data.subtotalPaise).toBe(10000);
  });

  it('Test 2: variant price change after order creation does not change the existing order', async () => {
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Snap Item 2 ${suffix}` });
    const itemId = item.body.data.id;
    const variant = await request(app.getHttpServer())
      .post('/api/v1/menu/variants')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ itemId, name: 'Full', pricePaise: 20000 });
    const variantId = variant.body.data.id;

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId, variantId, qty: 1 }],
      });
    expect(order.body.data.lines[0].unitPricePaise).toBe(20000);

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/variants/${variantId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ pricePaise: 25000 });

    const reread = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reread.body.data.lines[0].unitPricePaise).toBe(20000);
  });

  it('Test 3: addon price change after order creation does not change the existing order', async () => {
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Snap Item 3 ${suffix}`, basePricePaise: 5000 });
    const itemId = item.body.data.id;
    const addon = await request(app.getHttpServer())
      .post('/api/v1/menu/addons')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Snap Addon 3 ${suffix}`, pricePaise: 2000 });
    const addonId = addon.body.data.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ addons: [{ addonId, maxQty: 2 }] });

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId, qty: 1, addons: [{ addonId, qty: 1 }] }],
      });
    expect(order.body.data.lines[0].addons[0].unitPricePaise).toBe(2000);
    expect(order.body.data.lines[0].lineTotalPaise).toBe(7000);

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/addons/${addonId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ pricePaise: 3000 });

    const reread = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reread.body.data.lines[0].addons[0].unitPricePaise).toBe(2000);
    expect(reread.body.data.lines[0].lineTotalPaise).toBe(7000);
  });

  it('Test 4: removing the addon from the item does not remove it from the existing order line', async () => {
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Snap Item 4 ${suffix}`, basePricePaise: 5000 });
    const itemId = item.body.data.id;
    const addon = await request(app.getHttpServer())
      .post('/api/v1/menu/addons')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Snap Addon 4 ${suffix}`, pricePaise: 1500 });
    const addonId = addon.body.data.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ addons: [{ addonId, maxQty: 1 }] });

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey: randomUUID(),
        type: 'TAKEAWAY',
        lines: [{ itemId, qty: 1, addons: [{ addonId, qty: 1 }] }],
      });

    // Detach the addon from the item (empty addons array = full replace).
    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ addons: [] });

    const reread = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reread.body.data.lines[0].addons).toHaveLength(1);
    expect(reread.body.data.lines[0].addons[0].nameSnapshot).toContain('Snap Addon 4');
  });

  it('Test 5: deactivating the item leaves the existing order readable with its original snapshot', async () => {
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: `Snap Item 5 ${suffix}`, basePricePaise: 8000 });
    const itemId = item.body.data.id;

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });

    const reread = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reread.status).toBe(200);
    expect(reread.body.data.lines[0].unitPricePaise).toBe(8000);
    expect(reread.body.data.lines[0].itemNameSnapshot).toContain('Snap Item 5');
  });

  it('Test 6: renaming the item leaves the existing order showing the original snapshot name', async () => {
    const originalName = `Snap Item 6 Original ${suffix}`;
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: originalName, basePricePaise: 9000 });
    const itemId = item.body.data.id;

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    expect(order.body.data.lines[0].itemNameSnapshot).toBe(originalName);

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Snap Item 6 Renamed ${suffix}` });

    const reread = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reread.body.data.lines[0].itemNameSnapshot).toBe(originalName);
  });
});
