/**
 * Gate 7 Kitchen / KDS concurrency integration test.
 * Verifies optimistic concurrency control when two kitchen staff bump the same ticket simultaneously.
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

describeIfDb(
  'Gate 7 Kitchen concurrency — simultaneous bump race (real API + real Postgres)',
  () => {
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

    const ownerEmail = `gate7-conc-owner-${suffix}@example.com`;
    const ownerPassword = 'a-real-owner-password-123';
    let ownerToken: string;
    let tenantId: string;
    let itemId: string;

    it('setup tenant and order in ACCEPTED status', async () => {
      const provision = await request(app.getHttpServer())
        .post('/api/v1/platform/tenants')
        .set('x-platform-bootstrap-secret', bootstrapSecret)
        .send({
          name: 'Gate 7 Concurrency',
          slug: `gate7-conc-${suffix}`,
          ownerEmail,
          ownerPassword,
        });
      expect(provision.status).toBe(201);
      tenantId = provision.body.data.tenantId;

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      ownerToken = login.body.accessToken;

      await withTenantTx(rwPool, { tenantId }, (tx) =>
        tx.query(
          `UPDATE tenant_settings SET kitchen_display_enabled = true, orders_workflow = 'KITCHEN' WHERE tenant_id = $1`,
          [tenantId],
        ),
      );

      const cat = await request(app.getHttpServer())
        .post('/api/v1/menu/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `Cat ${suffix}` });

      const item = await request(app.getHttpServer())
        .post('/api/v1/menu/items')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ categoryId: cat.body.data.id, name: `Dosa ${suffix}`, basePricePaise: 12000 });
      itemId = item.body.data.id;
    });

    it('simultaneous bump race: exactly one 200, others receive 409 VERSION_CONFLICT', async () => {
      const orderRes = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          type: 'TAKEAWAY',
          idempotencyKey: randomUUID(),
          lines: [{ menuItemId: itemId, qty: 1 }],
        });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.data.id;

      // Accept order so it's in ACCEPTED state
      const acceptRes = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/transition`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ to: 'ACCEPTED', expectedVersion: orderRes.body.data.version });
      expect(acceptRes.status).toBe(200);
      const acceptedVersion = acceptRes.body.data.version;

      // Concurrently fire 4 requests trying to bump ACCEPTED -> PREPARING with the same expectedVersion
      const results = await Promise.all(
        Array.from({ length: 4 }).map(() =>
          request(app.getHttpServer())
            .post(`/api/v1/orders/${orderId}/transition`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ to: 'PREPARING', expectedVersion: acceptedVersion }),
        ),
      );

      const successes = results.filter((r) => r.status === 200);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(3);

      for (const conflict of conflicts) {
        expect(conflict.body.error.code).toBe('VERSION_CONFLICT');
      }
    });
  },
);
