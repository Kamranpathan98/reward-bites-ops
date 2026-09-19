/**
 * Gate 7 Kitchen / KDS vertical journey end-to-end integration tests.
 * Runs against real Postgres and real NestJS HTTP server.
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
import type { KitchenOrderTicketView, KitchenOrderLineView } from '@rewardbite/contracts';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

describeIfDb('Gate 7 vertical journey — Kitchen / KDS (real API + real Postgres)', () => {
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

  const ownerEmail = `gate7-kds-owner-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';
  let ownerToken: string;
  let tenantId: string;
  let tableId: string;
  let itemId: string;
  let addonId: string;

  it('setup: tenant, owner, table, menu item, and addon', async () => {
    const provision = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Gate 7 KDS Vertical',
        slug: `gate7-kds-${suffix}`,
        ownerEmail,
        ownerPassword,
      });
    expect(provision.status).toBe(201);
    tenantId = provision.body.data.tenantId;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    ownerToken = login.body.accessToken;

    const table = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `T-${suffix}` });
    tableId = table.body.data.id;

    const cat = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Mains ${suffix}` });

    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId: cat.body.data.id, name: `Biryani ${suffix}`, basePricePaise: 25000 });
    itemId = item.body.data.id;

    const addon = await request(app.getHttpServer())
      .post('/api/v1/menu/addons')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Extra Raita ${suffix}`, pricePaise: 3000 });
    addonId = addon.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ addons: [{ addonId, maxQty: 2 }] });
  });

  it('feature flag: rejects GET /kitchen/orders with 403 FEATURE_DISABLED when disabled', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('enables kitchen_display_enabled and orders_workflow in tenant_settings', async () => {
    await withTenantTx(rwPool, { tenantId }, (tx) =>
      tx.query(
        `UPDATE tenant_settings SET kitchen_display_enabled = true, orders_workflow = 'KITCHEN' WHERE tenant_id = $1`,
        [tenantId],
      ),
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.serverTime).toBeDefined();
  });

  it('reads active orders with table resolution, lines, addons, and no price exposure', async () => {
    // 1. Create DINE_IN order on table
    const order1Res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'DINE_IN',
        tableId,
        customerName: 'Aarav Patel',
        notes: 'Mild spicy',
        idempotencyKey: randomUUID(),
        lines: [
          {
            itemId: itemId,
            qty: 2,
            notes: 'Less oil',
            addons: [{ addonId, qty: 1 }],
          },
        ],
      });
    expect(order1Res.status).toBe(201);
    const order1Id = order1Res.body.data.id;

    // 2. Create TAKEAWAY order
    const order2Res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'TAKEAWAY',
        customerName: 'Takeaway Guest',
        idempotencyKey: randomUUID(),
        lines: [
          {
            itemId: itemId,
            qty: 1,
          },
        ],
      });
    expect(order2Res.status).toBe(201);
    const order2Id = order2Res.body.data.id;

    // 3. Query kitchen queue
    const queueRes = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(2);

    const ticket1 = queueRes.body.data.find((t: KitchenOrderTicketView) => t.id === order1Id);
    expect(ticket1).toBeDefined();
    expect(ticket1?.tableName).toBe(`T-${suffix}`);
    expect(ticket1?.customerName).toBe('Aarav Patel');
    expect(ticket1?.status).toBe('NEW');
    expect(ticket1?.notes).toBe('Mild spicy');
    expect(ticket1?.lines).toHaveLength(1);
    expect(ticket1?.lines[0].itemName).toBe(`Biryani ${suffix}`);
    expect(ticket1?.lines[0].qty).toBe(2);
    expect(ticket1?.lines[0].notes).toBe('Less oil');
    expect(ticket1?.lines[0].status).toBe('ACTIVE');
    expect(ticket1?.lines[0].addons).toHaveLength(1);
    expect(ticket1?.lines[0].addons[0].nameSnapshot).toBe(`Extra Raita ${suffix}`);
    expect(
      (ticket1?.lines[0] as unknown as Record<string, unknown>).unitPricePaise,
    ).toBeUndefined();

    const ticket2 = queueRes.body.data.find((t: KitchenOrderTicketView) => t.id === order2Id);
    expect(ticket2).toBeDefined();
    expect(ticket2?.tableName).toBe('Takeaway');
    expect(ticket2?.status).toBe('NEW');
  });

  it('reflects line edits with removed lines and edit reason', async () => {
    // Fetch current queue to get order1 and line
    const queueBefore = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);
    const ticket1: KitchenOrderTicketView = queueBefore.body.data[0];
    const lineId = ticket1.lines[0].id;

    // Edit order: add another line, remove old line
    const editRes = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${ticket1.id}/lines`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        expectedVersion: ticket1.version,
        reason: 'Guest changed mind',
        add: [{ itemId: itemId, qty: 1 }],
        remove: [lineId],
      });
    expect(editRes.status).toBe(200);

    const queueAfter = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);
    const updatedTicket = queueAfter.body.data.find(
      (t: KitchenOrderTicketView) => t.id === ticket1.id,
    );

    expect(updatedTicket?.isEdited).toBe(true);
    expect(updatedTicket?.editReason).toBe('Guest changed mind');
    expect(updatedTicket?.lines).toHaveLength(2);

    const removedLine = updatedTicket?.lines.find((l: KitchenOrderLineView) => l.id === lineId);
    expect(removedLine?.status).toBe('REMOVED');
    const activeLine = updatedTicket?.lines.find((l: KitchenOrderLineView) => l.id !== lineId);
    expect(activeLine?.status).toBe('ACTIVE');
  });

  it('transitions order through PREPARING -> READY, then excludes COMPLETED/CANCELLED', async () => {
    const queue = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);
    const [t1, t2] = queue.body.data;

    // t1: NEW -> ACCEPTED -> PREPARING -> READY -> COMPLETED
    const accRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${t1.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'ACCEPTED', expectedVersion: t1.version });
    expect(accRes.status).toBe(200);

    const prepRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${t1.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'PREPARING', expectedVersion: accRes.body.data.version });
    expect(prepRes.status).toBe(200);

    const readyRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${t1.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'READY', expectedVersion: prepRes.body.data.version });
    expect(readyRes.status).toBe(200);

    const compRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${t1.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ to: 'COMPLETED', expectedVersion: readyRes.body.data.version });
    expect(compRes.status).toBe(200);

    // Cancel t2
    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${t2.id}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Customer left', expectedVersion: t2.version });
    expect(cancelRes.status).toBe(200);

    // Kitchen queue should now be empty
    const finalQueue = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(finalQueue.status).toBe(200);
    expect(finalQueue.body.data).toEqual([]);
  });
});
