/**
 * Self-service onboarding — security/adversarial attack matrix (task
 * section 22, Attacks A-J), executed against the real HTTP API and real
 * PostgreSQL. Requires TEST_DATABASE_URL (app_rw) and
 * TEST_PLATFORM_DATABASE_URL (app_platform) — see docs/DEVELOPMENT.md.
 * Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;
const bootstrapSecret = 'test-only-bootstrap-secret-1234';

describeIfDb('RED TEAM — Onboarding self-service signup attack matrix', () => {
  let app: INestApplication;
  const suffix = Date.now();

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
    process.env['PLATFORM_BOOTSTRAP_SECRET'] = bootstrapSecret;
    process.env['SIGNUP_RATE_LIMIT_MAX_ATTEMPTS'] = '1000';
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

  function signupBody(overrides: Record<string, unknown> = {}) {
    return {
      tenantName: `Attack Diner ${suffix}`,
      ownerName: 'Attacker Owner',
      email: `attack-owner-${suffix}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'a-real-owner-password-123',
      passwordConfirmation: 'a-real-owner-password-123',
      ...overrides,
    };
  }

  it('Attack A: client-supplied tenantId is ignored, not honored', async () => {
    const foreignTenantId = '01a0b000-0000-7000-8000-000000000001';
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(), tenantId: foreignTenantId });
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].tenantId).not.toBe(foreignTenantId);
  });

  it('Attack B: client-supplied roleId is ignored — owner still gets the real Owner role', async () => {
    const fakeRoleId = '01a0b000-0000-7000-8000-000000000002';
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(), roleId: fakeRoleId });
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].roleName).toBe('Owner');
  });

  it('Attack C: signup payload cannot target a membership in another (existing) tenant', async () => {
    // Seed a real existing tenant via the platform bootstrap path.
    const seed = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: `Attack Victim ${suffix}`,
        slug: `attack-victim-${suffix}`,
        ownerEmail: `attack-victim-owner-${suffix}@example.com`,
        ownerPassword: 'a-real-owner-password-123',
      });
    expect(seed.status).toBe(201);
    const victimTenantId = seed.body.data.tenantId;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(), tenantId: victimTenantId, membershipTenantId: victimTenantId });
    expect(res.status).toBe(200);
    // The new owner's membership is to their OWN new tenant, never the victim's.
    expect(res.body.memberships[0].tenantId).not.toBe(victimTenantId);
  });

  it('Attack D: signup payload cannot modify an existing tenant (e.g. by reusing its slug)', async () => {
    const seed = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: `Attack Target ${suffix}`,
        slug: `attack-target-${suffix}`,
        ownerEmail: `attack-target-owner-${suffix}@example.com`,
        ownerPassword: 'a-real-owner-password-123',
      });
    expect(seed.status).toBe(201);

    // Try to sign up with the exact same restaurant name -> server
    // generates a DIFFERENT slug (collision suffix), never reuses/collides
    // with the existing tenant's slug or row.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: `Attack Target ${suffix}` }));
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].tenantSlug).not.toBe(`attack-target-${suffix}`);
    expect(res.body.memberships[0].tenantId).not.toBe(seed.body.data.tenantId);
  });

  it('Attack H: unauthenticated /auth/signup only ever performs the one intended operation', async () => {
    // The endpoint requires no Authorization header at all (that's the
    // point — it's public) but every OTHER platform/tenant-scoped
    // endpoint remains unreachable through it: signup returns exactly a
    // token for the NEW tenant, nothing else is exposed.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ email: `attack-h-${suffix}@example.com` }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'memberships']);
  });

  it('Attack I: a signup-created owner token cannot access platform endpoints', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ email: `attack-i-${suffix}@example.com` }));
    expect(res.status).toBe(200);

    const platformAttempt = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .send({
        name: 'Should Not Work',
        slug: `should-not-work-${suffix}`,
        ownerEmail: `should-not-work-${suffix}@example.com`,
        ownerPassword: 'a-real-owner-password-123',
      });
    // PlatformBootstrapGuard checks the bootstrap secret header, which a
    // tenant JWT can never satisfy.
    expect(platformAttempt.status).toBe(401);
  });

  it('Attack J: the platform bootstrap secret cannot be used as a tenant Bearer token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${bootstrapSecret}`);
    expect(res.status).toBe(401);
  });
});
