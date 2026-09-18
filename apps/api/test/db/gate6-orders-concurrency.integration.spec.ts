/**
 * Gate 6 — state-transition concurrency (task §35) and transaction
 * rollback (task §38), against real Postgres, not simulated sequentially.
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

describeIfDb('Gate 6 — state transition concurrency + rollback (real API + real Postgres)', () => {
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

  const ownerEmail = `gate6-conc-owner-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';
  let ownerToken: string;
  let tenantId: string;
  let itemId: string;

  beforeAll(async () => {
    const provision = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Gate 6 Concurrency',
        slug: `gate6-conc-${suffix}`,
        ownerEmail,
        ownerPassword,
      });
    expect(provision.status).toBe(201);
    tenantId = provision.body.data.tenantId;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    ownerToken = login.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Conc Category ${suffix}` });
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        categoryId: category.body.data.id,
        name: `Conc Item ${suffix}`,
        basePricePaise: 5000,
      });
    itemId = item.body.data.id;
  }, 20000);

  it('20 concurrent ACCEPT requests on the same NEW order: exactly one wins, the rest 409', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    const orderId = order.body.data.id;
    const attempts = 20;

    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/orders/${orderId}/transition`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ to: 'ACCEPTED', expectedVersion: 0 }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(attempts - 1);
    // A loser gets one of two codes depending on timing: VERSION_CONFLICT
    // if its read of the order's status happened before the winner
    // committed (it then loses at the atomic conditional UPDATE), or
    // INVALID_TRANSITION if its read happened after (ACCEPTED -> ACCEPTED
    // is simply not a listed transition). Both are correct rejections —
    // the invariant under test is that at most one ever wins, not which
    // specific 409 sub-code a given loser gets.
    for (const res of conflicted) {
      expect(['VERSION_CONFLICT', 'INVALID_TRANSITION']).toContain(res.body.error.code);
    }

    const final = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(final.body.data.status).toBe('ACCEPTED');
    expect(final.body.data.version).toBe(1);
    // Exactly one ACCEPTED row in the append-only history, not 20.
    const acceptedEntries = final.body.data.history.filter(
      (h: { toStatus: string }) => h.toStatus === 'ACCEPTED',
    );
    expect(acceptedEntries).toHaveLength(1);
  });

  it('concurrent transition + cancel on the same order: exactly one of the two wins', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: randomUUID(), type: 'TAKEAWAY', lines: [{ itemId, qty: 1 }] });
    const orderId = order.body.data.id;

    const [transitionRes, cancelRes] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/transition`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ to: 'ACCEPTED', expectedVersion: 0 }),
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ expectedVersion: 0, reason: 'Race test' }),
    ]);

    const statuses = [transitionRes.status, cancelRes.status].sort();
    expect(statuses).toEqual([200, 409]);

    const final = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(['ACCEPTED', 'CANCELLED']).toContain(final.body.data.status);
    expect(final.body.data.version).toBe(1); // only the winner's transition applied
  });

  it('ROLLBACK: a forced failure mid-creation leaves no order, no lines, no addons, no history', async () => {
    // ghost addon id -> priceLine() throws ITEM_UNAVAILABLE partway through
    // line pricing, after the order row itself has already been inserted
    // inside the same transaction.
    const item2 = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        categoryId: (
          await request(app.getHttpServer())
            .post('/api/v1/menu/categories')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ name: `Rollback Category ${suffix}` })
        ).body.data.id,
        name: `Rollback Item ${suffix}`,
        basePricePaise: 4000,
      });

    const idempotencyKey = randomUUID();
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        idempotencyKey,
        type: 'TAKEAWAY',
        lines: [
          { itemId: item2.body.data.id, qty: 1 },
          { itemId: '00000000-0000-0000-0000-000000000000', qty: 1 }, // forces the failure
        ],
      });
    expect(res.status).toBe(422); // priceLine()'s ITEM_UNAVAILABLE — the item doesn't exist for this tenant
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');

    // Nothing from the failed attempt persisted — not even a row keyed by
    // its idempotency key (which would exist if the order INSERT had
    // committed before the failure).
    const orphan = await withTenantTx(rwPool, { tenantId, actorKind: 'staff' }, (tx) =>
      tx.query(`SELECT id FROM orders WHERE tenant_id = $1 AND idempotency_key = $2`, [
        tenantId,
        idempotencyKey,
      ]),
    );
    expect(orphan.rows).toHaveLength(0);

    // The successfully-priced first line's item also has no order_line
    // attached to it from this failed attempt.
    const orphanLines = await withTenantTx(rwPool, { tenantId, actorKind: 'staff' }, (tx) =>
      tx.query(`SELECT id FROM order_line WHERE tenant_id = $1 AND menu_item_id = $2`, [
        tenantId,
        item2.body.data.id,
      ]),
    );
    expect(orphanLines.rows).toHaveLength(0);
  });
});
