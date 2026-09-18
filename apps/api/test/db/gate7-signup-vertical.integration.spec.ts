/**
 * Self-service onboarding — core vertical journey, executed against the
 * real HTTP API and real PostgreSQL. Requires TEST_DATABASE_URL (app_rw)
 * and TEST_PLATFORM_DATABASE_URL (app_platform) — see
 * docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
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

describeIfDb('Onboarding — self-service signup vertical journey', () => {
  let app: INestApplication;
  let platformPool: Pool;
  const suffix = Date.now();

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
    process.env['PLATFORM_BOOTSTRAP_SECRET'] ??= 'test-only-bootstrap-secret-1234';
    // This file's own journey makes many real signup calls from one
    // loopback IP — the rate limiter itself is exercised separately in
    // gate7-signup-rate-limit.integration.spec.ts, with its own low
    // threshold and its own app instance.
    process.env['SIGNUP_RATE_LIMIT_MAX_ATTEMPTS'] = '1000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    await app.init();
    platformPool = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL });
  });

  afterAll(async () => {
    await app.close();
    await platformPool.end();
  });

  function signupBody(overrides: Partial<Record<string, string>> = {}) {
    return {
      tenantName: `Onboarding Diner ${suffix}`,
      ownerName: 'Priya Owner',
      email: `onboarding-owner-${suffix}@example.com`,
      password: 'a-real-owner-password-123',
      passwordConfirmation: 'a-real-owner-password-123',
      ...overrides,
    };
  }

  it('signs up, auto-logs in with a tenant-bound token, and /auth/me resolves the new owner', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/signup').send(signupBody());

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].roleName).toBe('Owner');
    expect(res.body.memberships[0].tenantName).toBe(`Onboarding Diner ${suffix}`);
    expect(res.body.memberships[0].tenantSlug).toBe(`onboarding-diner-${suffix}`);
    // Refresh token in an HttpOnly cookie, never the response body.
    expect(res.headers['set-cookie']?.[0]).toMatch(/refresh_token=.*HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(`onboarding-owner-${suffix}@example.com`);
    expect(me.body.user.fullName).toBe('Priya Owner');
    expect(me.body.membership.roleName).toBe('Owner');
    // Owner gets the full permission set the existing provisioning
    // transaction already grants — not re-derived by the signup path.
    expect(me.body.permissions).toEqual(expect.arrayContaining(['tables.manage', 'menu.manage']));
  });

  it('the owner can immediately use Gate 4 table creation to complete first-time setup', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ email: `onboarding-setup-${suffix}@example.com` }));
    expect(signup.status).toBe(200);
    const token = signup.body.accessToken;

    const before = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${token}`);
    expect(before.body.data).toHaveLength(0);

    const created = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Table 1' });
    expect(created.status).toBe(201);

    const after = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.data).toHaveLength(1);
  });

  it('rejects a mismatched password confirmation before touching the database (422/400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ passwordConfirmation: 'does-not-match-at-all' }));
    expect([400, 422]).toContain(res.status);
  });

  it('generates deterministic, collision-free slugs for identical restaurant names', async () => {
    const name = `Collision Diner ${suffix}`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: name, email: `collision-1-${suffix}@example.com` }));
    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: name, email: `collision-2-${suffix}@example.com` }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.memberships[0].tenantSlug).not.toBe(second.body.memberships[0].tenantSlug);
    expect(second.body.memberships[0].tenantSlug).toBe(`collision-diner-${suffix}-2`);
  });

  it('Attack E: signing up again with an existing email is safely rejected, not silently attached', async () => {
    const email = `existing-email-${suffix}@example.com`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ email }));
    expect(first.status).toBe(200);
    const firstTenantId = first.body.memberships[0].tenantId;

    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: `Second Attempt ${suffix}`, email }));
    expect(second.status).toBe(409);

    // The original account/membership is completely unaffected.
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`);
    expect(me.body.tenant.id).toBe(firstTenantId);

    const userCount = await platformPool.query(
      `SELECT count(*) FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    expect(Number(userCount.rows[0].count)).toBe(1);
  });
});
