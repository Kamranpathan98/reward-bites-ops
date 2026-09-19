/**
 * Gate 7 Kitchen / KDS tenant isolation and RBAC integration tests.
 * Validates cross-tenant boundaries, Kitchen Staff role permissions, and unauthenticated access rejection.
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

describeIfDb('Gate 7 Kitchen — tenant isolation + RBAC (real API + real Postgres)', () => {
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

  let tenantAId: string;
  let tenantBId: string;
  let ownerAToken: string;
  let ownerBToken: string;
  let kitchenTokenA: string;
  let itemAId: string;
  let itemBId: string;

  it('provision two tenants with kitchen display enabled, menus, and staff', async () => {
    // Tenant A
    const ownerAEmail = `gate7-iso-owner-a-${suffix}@example.com`;
    const provA = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Tenant A Kitchen',
        slug: `tenant-a-kds-${suffix}`,
        ownerEmail: ownerAEmail,
        ownerPassword: 'password-123',
      });
    tenantAId = provA.body.data.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerAEmail, password: 'password-123' });
    ownerAToken = loginA.body.accessToken;

    // Tenant B
    const ownerBEmail = `gate7-iso-owner-b-${suffix}@example.com`;
    const provB = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Tenant B Kitchen',
        slug: `tenant-b-kds-${suffix}`,
        ownerEmail: ownerBEmail,
        ownerPassword: 'password-123',
      });
    tenantBId = provB.body.data.tenantId;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerBEmail, password: 'password-123' });
    ownerBToken = loginB.body.accessToken;

    // Enable kitchen display on both
    await withTenantTx(rwPool, { tenantId: tenantAId }, (tx) =>
      tx.query(
        `UPDATE tenant_settings SET kitchen_display_enabled = true, orders_workflow = 'KITCHEN' WHERE tenant_id = $1`,
        [tenantAId],
      ),
    );
    await withTenantTx(rwPool, { tenantId: tenantBId }, (tx) =>
      tx.query(
        `UPDATE tenant_settings SET kitchen_display_enabled = true, orders_workflow = 'KITCHEN' WHERE tenant_id = $1`,
        [tenantBId],
      ),
    );

    // Create menu items
    const catA = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: `Cat A ${suffix}` });
    const itemA = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ categoryId: catA.body.data.id, name: `Dish A ${suffix}`, basePricePaise: 10000 });
    itemAId = itemA.body.data.id;

    const catB = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ name: `Cat B ${suffix}` });
    const itemB = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ categoryId: catB.body.data.id, name: `Dish B ${suffix}`, basePricePaise: 10000 });
    itemBId = itemB.body.data.id;

    // Invite Kitchen Staff in Tenant A
    const rolesRes = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAToken}`);
    const kitchenRole = rolesRes.body.data.find(
      (r: { name: string }) => r.name === 'Kitchen Staff',
    );
    const kitchenEmail = `kitchen-staff-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        email: kitchenEmail,
        fullName: 'Chef Sanjeev',
        roleId: kitchenRole.id,
        tempPassword: 'kitchen-staff-pass-123',
      });
    const kitchenLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: kitchenEmail, password: 'kitchen-staff-pass-123' });
    kitchenTokenA = kitchenLogin.body.accessToken;
  });

  it('tenant isolation: Tenant A kitchen only sees Tenant A tickets', async () => {
    // Create order in Tenant A
    const orderARes = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        type: 'TAKEAWAY',
        idempotencyKey: randomUUID(),
        lines: [{ itemId: itemAId, qty: 1 }],
      });
    expect(orderARes.status).toBe(201);
    const orderAId = orderARes.body.data.id;

    // Create order in Tenant B
    const orderBRes = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({
        type: 'TAKEAWAY',
        idempotencyKey: randomUUID(),
        lines: [{ itemId: itemBId, qty: 1 }],
      });
    expect(orderBRes.status).toBe(201);
    const orderBId = orderBRes.body.data.id;

    // Tenant A Kitchen Staff checks queue
    const queueA = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${kitchenTokenA}`);
    expect(queueA.status).toBe(200);

    const foundA = queueA.body.data.find((t: { id: string }) => t.id === orderAId);
    const foundB = queueA.body.data.find((t: { id: string }) => t.id === orderBId);
    expect(foundA).toBeDefined();
    expect(foundB).toBeUndefined(); // Zero cross-tenant leakage

    // Tenant B Owner checks queue
    const queueB = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(queueB.status).toBe(200);

    const foundInB = queueB.body.data.find((t: { id: string }) => t.id === orderBId);
    const leakAInB = queueB.body.data.find((t: { id: string }) => t.id === orderAId);
    expect(foundInB).toBeDefined();
    expect(leakAInB).toBeUndefined();
  });

  it('RBAC enforcement: Kitchen Staff cannot accept NEW orders or cancel orders', async () => {
    const queueA = await request(app.getHttpServer())
      .get('/api/v1/kitchen/orders')
      .set('Authorization', `Bearer ${kitchenTokenA}`);
    const newTicket = queueA.body.data.find((t: { status: string }) => t.status === 'NEW');
    expect(newTicket).toBeDefined();

    // 1. Kitchen Staff attempts NEW -> ACCEPTED (refused: requires orders.transition.front)
    const acceptAttempt = await request(app.getHttpServer())
      .post(`/api/v1/orders/${newTicket.id}/transition`)
      .set('Authorization', `Bearer ${kitchenTokenA}`)
      .send({ to: 'ACCEPTED', expectedVersion: newTicket.version });
    expect(acceptAttempt.status).toBe(403);
    expect(acceptAttempt.body.error.code).toBe('PERMISSION_DENIED');

    // 2. Kitchen Staff attempts Cancel (refused: requires orders.cancel)
    const cancelAttempt = await request(app.getHttpServer())
      .post(`/api/v1/orders/${newTicket.id}/cancel`)
      .set('Authorization', `Bearer ${kitchenTokenA}`)
      .send({ reason: 'Kitchen cannot make this' });
    expect(cancelAttempt.status).toBe(403);

    // 3. Owner accepts order (front transition)
    const ownerAccept = await request(app.getHttpServer())
      .post(`/api/v1/orders/${newTicket.id}/transition`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ to: 'ACCEPTED', expectedVersion: newTicket.version });
    expect(ownerAccept.status).toBe(200);
    const acceptedVersion = ownerAccept.body.data.version;

    // 4. Kitchen Staff transitions ACCEPTED -> PREPARING (permitted: orders.transition.kitchen)
    const startCook = await request(app.getHttpServer())
      .post(`/api/v1/orders/${newTicket.id}/transition`)
      .set('Authorization', `Bearer ${kitchenTokenA}`)
      .send({ to: 'PREPARING', expectedVersion: acceptedVersion });
    expect(startCook.status).toBe(200);
    const prepVersion = startCook.body.data.version;

    // 5. Kitchen Staff transitions PREPARING -> READY (permitted: orders.transition.kitchen)
    const markReady = await request(app.getHttpServer())
      .post(`/api/v1/orders/${newTicket.id}/transition`)
      .set('Authorization', `Bearer ${kitchenTokenA}`)
      .send({ to: 'READY', expectedVersion: prepVersion });
    expect(markReady.status).toBe(200);
    const readyVersion = markReady.body.data.version;

    // 6. Kitchen Staff attempts READY -> COMPLETED (refused: requires orders.transition.front)
    const completeAttempt = await request(app.getHttpServer())
      .post(`/api/v1/orders/${newTicket.id}/transition`)
      .set('Authorization', `Bearer ${kitchenTokenA}`)
      .send({ to: 'COMPLETED', expectedVersion: readyVersion });
    expect(completeAttempt.status).toBe(403);
    expect(completeAttempt.body.error.code).toBe('PERMISSION_DENIED');

    // 7. Kitchen Staff cannot read full order details or financial records
    const readFullOrder = await request(app.getHttpServer())
      .get(`/api/v1/orders/${newTicket.id}`)
      .set('Authorization', `Bearer ${kitchenTokenA}`);
    expect(readFullOrder.status).toBe(403);
  });

  it('unauthenticated requests rejected with 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/kitchen/orders');
    expect(res.status).toBe(401);
  });
});
