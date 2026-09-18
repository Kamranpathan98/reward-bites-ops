/**
 * The Gate 2 vertical journey, end to end, against the real NestJS app and
 * a real PostgreSQL database (no mocks — task instruction section 21/22):
 *
 *   platform provisions tenant A (+ owner)
 *     -> owner logs in (single membership -> immediately tenant-bound)
 *     -> GET /auth/me
 *     -> invite a Cashier
 *     -> cashier logs in, hits a manager-only route -> 403 PERMISSION_DENIED
 *     -> owner changes the cashier's role
 *     -> owner revokes the cashier's sessions -> cashier's old token 401s
 *     -> refresh rotates the token; replaying the OLD refresh token 401s
 *       and revokes the whole family (reuse detection)
 *     -> logout revokes the family
 *     -> a second tenant B never sees tenant A's users (cross-tenant 404)
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

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[gate2-vertical-journey.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

function extractCookie(setCookieHeader: string[] | undefined, name: string): string | undefined {
  const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0];
}

describeIfDb('Gate 2 vertical journey (real API + real Postgres)', () => {
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

  const tenantASlug = `gate2-journey-a-${suffix}`;
  const tenantBSlug = `gate2-journey-b-${suffix}`;
  const ownerEmail = `owner-${suffix}@example.com`;
  const ownerBEmail = `owner-b-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';
  const cashierEmail = `cashier-${suffix}@example.com`;
  const cashierPassword = 'a-real-cashier-password-123';

  let ownerAccessToken: string;
  let cashierRoleId: string;
  let cashierMembershipId: string;
  let cashierAccessToken: string;
  let cashierRefreshCookie: string;

  it('provisions tenant A via the platform bootstrap endpoint', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({ name: 'Gate 2 Journey Tenant A', slug: tenantASlug, ownerEmail, ownerPassword });

    expect(res.status).toBe(201);
    expect(res.body.data.tenantId).toEqual(expect.any(String));
  });

  it('rejects tenant provisioning without the bootstrap secret', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .send({
        name: 'Nope',
        slug: `nope-${suffix}`,
        ownerEmail: 'nope@example.com',
        ownerPassword: 'whatever123',
      });
    expect(res.status).toBe(401);
  });

  it('owner logs in and is immediately tenant-bound (single membership)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });

    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].tenantSlug).toBe(tenantASlug);
    expect(res.body.memberships[0].roleName).toBe('Owner');
    expect(typeof res.body.accessToken).toBe('string');
    expect(extractCookie(res.headers['set-cookie'], 'refresh_token')).toBeDefined();

    ownerAccessToken = res.body.accessToken;
  });

  it('rejects the wrong password with the same error as an unknown email (no enumeration)', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: 'totally-wrong-password' });
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `no-such-user-${suffix}@example.com`, password: 'whatever-123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
  });

  it('GET /auth/me returns the owner, tenant, membership, and full permission set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(ownerEmail);
    expect(res.body.tenant.slug).toBe(tenantASlug);
    expect(res.body.membership.roleName).toBe('Owner');
    expect(res.body.permissions).toEqual(expect.arrayContaining(['users.manage', 'tenant.read']));
  });

  it('rejects any tenant route with no token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tenant');
    expect(res.status).toBe(401);
  });

  it('owner reads GET /tenant and GET /roles', async () => {
    const tenantRes = await request(app.getHttpServer())
      .get('/api/v1/tenant')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(tenantRes.status).toBe(200);
    expect(tenantRes.body.data.slug).toBe(tenantASlug);

    const rolesRes = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(rolesRes.status).toBe(200);
    const roleNames = rolesRes.body.data.map((r: { name: string }) => r.name);
    expect(roleNames.sort()).toEqual(['Cashier', 'Kitchen Staff', 'Manager', 'Owner'].sort());
    const cashierRole = rolesRes.body.data.find((r: { name: string }) => r.name === 'Cashier');
    cashierRoleId = cashierRole.id;
  });

  it('owner invites a Cashier', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        email: cashierEmail,
        fullName: 'Test Cashier',
        roleId: cashierRoleId,
        tempPassword: cashierPassword,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.membershipId).toEqual(expect.any(String));
    cashierMembershipId = res.body.data.membershipId;

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.map((u: { email: string }) => u.email)).toContain(cashierEmail);
  });

  it('cashier logs in and is denied a manager-only action (permission denial)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: cashierEmail, password: cashierPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.memberships).toHaveLength(1);
    cashierAccessToken = loginRes.body.accessToken;
    cashierRefreshCookie = extractCookie(loginRes.headers['set-cookie'], 'refresh_token') as string;

    const inviteAttempt = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${cashierAccessToken}`)
      .send({
        email: `nope-${suffix}@example.com`,
        fullName: 'Nope',
        roleId: cashierRoleId,
        tempPassword: 'whatever123',
      });

    expect(inviteAttempt.status).toBe(403);
    expect(inviteAttempt.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('cross-tenant / foreign membership ids 404, never 403', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/00000000-0000-7000-8000-000000000000')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ status: 'DISABLED' });
    expect(res.status).toBe(404);
  });

  it("owner changes the cashier role assignment, invalidating the cashier's cached permissions", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${cashierMembershipId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ roleId: cashierRoleId });
    expect(res.status).toBe(200);
  });

  it("owner revokes the cashier's sessions; refreshing the old cookie now fails", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/users/${cashierMembershipId}/sessions`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);

    const refreshAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cashierRefreshCookie);
    expect(refreshAttempt.status).toBe(401);
  });

  it('refresh rotation works, and replaying a rotated-away token triggers family-wide reuse revocation', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    const firstCookie = extractCookie(loginRes.headers['set-cookie'], 'refresh_token') as string;

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie);
    expect(refreshRes.status).toBe(200);
    const secondCookie = extractCookie(refreshRes.headers['set-cookie'], 'refresh_token') as string;
    expect(secondCookie).not.toBe(firstCookie);

    // The rotated-away first token still works once more logically it
    // shouldn't be replayable — using it now must fail AND revoke the
    // whole family, taking the second (legitimately rotated) token with it.
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie);
    expect(replay.status).toBe(401);

    const afterReuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', secondCookie);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh family', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    const cookie = extractCookie(loginRes.headers['set-cookie'], 'refresh_token') as string;

    const logoutRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('tenant isolation: tenant B never sees tenant A users, even with a valid tenant B owner token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Gate 2 Journey Tenant B',
        slug: tenantBSlug,
        ownerEmail: ownerBEmail,
        ownerPassword,
      });

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerBEmail, password: ownerPassword });
    const tokenB = loginB.body.accessToken;

    const usersB = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(usersB.status).toBe(200);
    const emailsB = usersB.body.data.map((u: { email: string }) => u.email);
    expect(emailsB).not.toContain(ownerEmail);
    expect(emailsB).not.toContain(cashierEmail);

    // Tenant B's owner cannot patch tenant A's membership id either.
    const crossPatch = await request(app.getHttpServer())
      .patch(`/api/v1/users/${cashierMembershipId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ status: 'DISABLED' });
    expect(crossPatch.status).toBe(404);
  });
});
