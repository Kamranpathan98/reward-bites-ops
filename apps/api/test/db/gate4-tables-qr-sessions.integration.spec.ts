/**
 * Gate 4 (Tables + QR) vertical journey, end to end, against the real
 * NestJS app and a real PostgreSQL database — table CRUD, QR regenerate,
 * the live floor view, session read/close, soft-delete blocked by an open
 * session, and tenant isolation.
 *
 * Session "open" has no HTTP endpoint yet (architecture: a session opens
 * implicitly on a table's first order — Gates 6/11), so this suite opens
 * one directly through TableSessionRepository, exactly like the real
 * `orders`/`public` modules will when they exist.
 *
 * Requires TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL
 * (app_platform) — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { withTenantTx } from '../../src/common/db';
import { TableSessionRepository } from '../../src/modules/tables/table-session.repository';
import { generateOpaqueToken } from '../../src/common/security/opaque-token';
import { Pool } from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[gate4-tables-qr-sessions.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('Gate 4 vertical journey — tables, QR, sessions (real API + real Postgres)', () => {
  let app: INestApplication;
  let pool: Pool;
  const sessionRepository = new TableSessionRepository();
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

    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const tenantASlug = `gate4-journey-a-${suffix}`;
  const tenantBSlug = `gate4-journey-b-${suffix}`;
  const ownerEmail = `gate4-owner-a-${suffix}@example.com`;
  const ownerBEmail = `gate4-owner-b-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';

  let tenantAId: string;
  let ownerAccessToken: string;
  let ownerBAccessToken: string;
  let tableId: string;

  it('provisions tenant A and tenant B, and logs both owners in', async () => {
    const provisionA = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({ name: 'Gate 4 Journey Tenant A', slug: tenantASlug, ownerEmail, ownerPassword });
    expect(provisionA.status).toBe(201);
    tenantAId = provisionA.body.data.tenantId;

    const provisionB = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Gate 4 Journey Tenant B',
        slug: tenantBSlug,
        ownerEmail: ownerBEmail,
        ownerPassword,
      });
    expect(provisionB.status).toBe(201);

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    expect(loginA.status).toBe(200);
    ownerAccessToken = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerBEmail, password: ownerPassword });
    expect(loginB.status).toBe(200);
    ownerBAccessToken = loginB.body.accessToken;
  });

  it('creates a table', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Table 1', capacity: 4 });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toEqual(expect.any(String));
    tableId = res.body.data.id;
  });

  it('rejects a duplicate table name for the same tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Table 1' });
    expect(res.status).toBe(409);
  });

  it('lists the table with hasActiveQr = false before any QR is issued', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    const table = res.body.data.find((t: { id: string }) => t.id === tableId);
    expect(table).toBeDefined();
    expect(table.hasActiveQr).toBe(false);
  });

  it('patches the table', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ capacity: 6 });
    expect(res.status).toBe(200);
  });

  let issuedToken: string;

  it('regenerates (issues) a QR token for the table', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/qr/regenerate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(201);
    expect(res.body.data.token).toEqual(expect.any(String));
    issuedToken = res.body.data.token;
  });

  it('regenerating again revokes the old token and issues a different one', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/tables/${tableId}/qr/regenerate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(201);
    expect(res.body.data.token).not.toBe(issuedToken);

    const list = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    const table = list.body.data.find((t: { id: string }) => t.id === tableId);
    expect(table.hasActiveQr).toBe(true);
  });

  it('renders the QR as an SVG', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}/qr.svg`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks).toString('utf-8')));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body as unknown as string).toContain('<svg');
  });

  it('renders the printable QR sheet as a PDF', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tables/qr-sheet.pdf')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('shows the table on the live floor view with no open session', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tables/live')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    const table = res.body.data.find((t: { id: string }) => t.id === tableId);
    expect(table).toBeDefined();
    expect(table.openSession).toBeNull();
  });

  let sessionId: string;

  it('opens a session directly (no HTTP endpoint until Gates 6/11) and blocks soft-delete', async () => {
    sessionId = await withTenantTx(
      pool,
      { tenantId: tenantAId, actorKind: 'staff' },
      async (tx) => {
        const session = await sessionRepository.openForTable(tx, {
          tenantId: tenantAId,
          tableId,
          sessionToken: generateOpaqueToken(),
          openedByUserId: null,
        });
        return session.id;
      },
    );

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(del.status).toBe(409);
  });

  it('the live floor view now shows the open session', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tables/live')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    const table = res.body.data.find((t: { id: string }) => t.id === tableId);
    expect(table.openSession).not.toBeNull();
    expect(table.openSession.id).toBe(sessionId);
  });

  it('GET /sessions/:id returns the session', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.tableId).toBe(tableId);
  });

  it('closes the session, then soft-delete succeeds', async () => {
    const close = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/close`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({});
    expect(close.status).toBe(200);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(get.body.data.status).toBe('CLOSED');

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(del.status).toBe(200);
  });

  it('closing an already-closed session 409s', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/close`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({});
    expect(res.status).toBe(409);
  });

  it('tenant isolation: tenant B never sees tenant A tables or sessions', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${ownerBAccessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.find((t: { id: string }) => t.id === tableId)).toBeUndefined();

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${ownerBAccessToken}`)
      .send({ capacity: 2 });
    expect(patch.status).toBe(404);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${ownerBAccessToken}`);
    expect(session.status).toBe(404);
  });
});
