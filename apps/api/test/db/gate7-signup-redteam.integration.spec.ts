/**
 * Strict red-team review of self-service signup (see the review brief for
 * the full attack list). Covers what the earlier Gate 7 test files do NOT
 * already cover: reuse of REAL existing tenant/user/membership/role UUIDs,
 * extreme input manipulation, forged-JWT audience-boundary attacks, and a
 * concurrent same-key rate-limiter proof. Executed against the real HTTP
 * API and real PostgreSQL. Requires TEST_DATABASE_URL (app_rw) and
 * TEST_PLATFORM_DATABASE_URL (app_platform) — see docs/DEVELOPMENT.md.
 * Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { withGlobalTx } from '../../src/common/db/with-global-tx';
import { withTenantTx } from '../../src/common/db/with-tenant-tx';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;
const bootstrapSecret = 'test-only-bootstrap-secret-1234';
const JWT_SECRET = 'test-only-jwt-secret-at-least-32-characters-long';

describeIfDb('RED TEAM — Onboarding signup, existing-record & input-manipulation attacks', () => {
  let app: INestApplication;
  let platformPool: Pool;
  const suffix = Date.now();

  // A real, existing tenant + owner + membership + role, seeded through the
  // platform bootstrap path — the "victim" every attack below tries to
  // read, reuse, attach to, or modify via the public signup endpoint.
  let victimTenantId: string;
  let victimUserId: string;
  let victimMembershipId: string;
  let victimRoleId: string;
  let victimOwnerToken: string;

  function signupBody(overrides: Record<string, unknown> = {}) {
    return {
      tenantName: `Redteam Diner ${suffix}`,
      ownerName: 'Redteam Owner',
      email: `redteam-owner-${suffix}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'a-real-owner-password-123',
      passwordConfirmation: 'a-real-owner-password-123',
      ...overrides,
    };
  }

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= JWT_SECRET;
    process.env['PLATFORM_BOOTSTRAP_SECRET'] = bootstrapSecret;
    process.env['SIGNUP_RATE_LIMIT_MAX_ATTEMPTS'] = '1000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    await app.init();
    platformPool = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL });

    const seed = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: `Redteam Victim ${suffix}`,
        slug: `redteam-victim-${suffix}`,
        ownerEmail: `redteam-victim-owner-${suffix}@example.com`,
        ownerPassword: 'a-real-owner-password-123',
      });
    expect(seed.status).toBe(201);
    victimTenantId = seed.body.data.tenantId;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `redteam-victim-owner-${suffix}@example.com`,
        password: 'a-real-owner-password-123',
      });
    expect(login.status).toBe(200);
    victimOwnerToken = login.body.accessToken;

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${victimOwnerToken}`);
    victimUserId = me.body.user.id;
    victimMembershipId = me.body.membership.id;
    victimRoleId = me.body.membership.roleId;
  }, 30000); // App bootstrap + 3 HTTP round-trips can exceed Jest's 5s
  // default when this file runs late in the full 18-file --runInBand
  // suite, under accumulated resource pressure — not a functional issue.

  afterAll(async () => {
    await app.close();
    await platformPool.end();
  });

  // tenant's RLS policy requires app.actor_kind = 'platform' (or a matching
  // app.tenant_id) — a raw platformPool query with no context set sees zero
  // rows regardless of grants (same pitfall documented in
  // rls-tenant-membership.integration.spec.ts), so every direct read here
  // goes through withGlobalTx.
  async function tenantRow(tenantId: string): Promise<{ name: string; slug: string } | null> {
    const result = await withGlobalTx(platformPool, { actorKind: 'platform' }, (tx) =>
      tx.query<{ name: string; slug: string }>(`SELECT name, slug FROM tenant WHERE id = $1`, [
        tenantId,
      ]),
    );
    return result.rows[0] ?? null;
  }

  // ---------------------------------------------------------------------
  // Section 3: existing-tenant attacks with REAL existing IDs
  // ---------------------------------------------------------------------

  it('signup with an existing tenantId in the body never touches that tenant', async () => {
    const before = await tenantRow(victimTenantId);
    expect(before).not.toBeNull(); // sanity: the victim genuinely exists and is visible

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(), tenantId: victimTenantId, id: victimTenantId });
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].tenantId).not.toBe(victimTenantId);

    const after = await tenantRow(victimTenantId);
    expect(after).toEqual(before);
  });

  it('signup with an existing membershipId/roleId in the body cannot create a membership in the victim tenant', async () => {
    const before = await withTenantTx(
      platformPool,
      { tenantId: victimTenantId, actorKind: 'platform' },
      (tx) =>
        tx.query<{ count: string }>(`SELECT count(*) FROM tenant_membership WHERE tenant_id = $1`, [
          victimTenantId,
        ]),
    );
    expect(Number(before.rows[0]!.count)).toBeGreaterThan(0); // sanity

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        ...signupBody(),
        membershipId: victimMembershipId,
        roleId: victimRoleId,
        tenantId: victimTenantId,
      });
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].roleName).toBe('Owner'); // still its own fresh Owner role

    const after = await withTenantTx(
      platformPool,
      { tenantId: victimTenantId, actorKind: 'platform' },
      (tx) =>
        tx.query<{ count: string }>(`SELECT count(*) FROM tenant_membership WHERE tenant_id = $1`, [
          victimTenantId,
        ]),
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count); // unchanged
  });

  it('signup cannot use an existing userId to attach to (or impersonate) the victim owner', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ ...signupBody(), userId: victimUserId, ownerId: victimUserId });
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].tenantId).not.toBe(victimTenantId);

    // Victim owner can still log in with their ORIGINAL password — proves
    // signup never touched their user row (e.g. never reset the hash).
    const stillWorks = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `redteam-victim-owner-${suffix}@example.com`,
        password: 'a-real-owner-password-123',
      });
    expect(stillWorks.status).toBe(200);
  });

  it('signup payload cannot rename/re-slug the victim tenant', async () => {
    const before = await tenantRow(victimTenantId);
    expect(before).not.toBeNull(); // sanity

    const collide = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(
        signupBody({
          tenantName: `Redteam Victim ${suffix}`, // same name as victim -> forces a slug-collision retry path
          email: `rename-attack-${suffix}@example.com`,
        }),
      );
    expect(collide.status).toBe(200);
    // The retry produced a DIFFERENT tenant with a collision-suffixed
    // slug, never touched/renamed the victim.
    expect(collide.body.memberships[0].tenantId).not.toBe(victimTenantId);

    const after = await tenantRow(victimTenantId);
    expect(after).toEqual(before);
  });

  // ---------------------------------------------------------------------
  // Section 4/5: input manipulation & mass assignment
  // ---------------------------------------------------------------------

  it('accepts and safely ignores every extra/nested/snake_case field an attacker might send', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        ...signupBody({ email: `mass-assign-${suffix}@example.com` }),
        tenant_id: victimTenantId,
        user_id: victimUserId,
        membership_id: victimMembershipId,
        role_id: victimRoleId,
        permissionId: 'tenant.delete',
        permissions: ['tenant.delete', 'users.manage'],
        role: 'PLATFORM_ADMIN',
        isPlatformAdmin: true,
        actorKind: 'platform',
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
        securityVersion: 999,
        nested: { tenantId: victimTenantId, roleId: victimRoleId },
        __proto__: { isAdmin: true },
      });
    expect(res.status).toBe(200);
    expect(res.body.memberships[0].roleName).toBe('Owner');
    expect(res.body.memberships[0].tenantId).not.toBe(victimTenantId);
  });

  it('rejects malformed UUID-shaped ids gracefully (no 500, no SQL error surfaced)', async () => {
    const attempts = [
      { tenantId: 'not-a-uuid' },
      { tenantId: "'; DROP TABLE tenant; --" },
      { tenantId: '../../etc/passwd' },
      { tenantId: '00000000-0000-0000-0000-000000000000' },
      { email: `sql-${suffix}@example.com'; DROP TABLE tenant; --` },
    ];
    for (const overrides of attempts) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send(signupBody({ email: `manip-${Math.random()}-${suffix}@example.com`, ...overrides }));
      // Either validated away (400/422) or ignored and succeeds (200) —
      // never a raw DB/server error.
      expect([200, 400, 422]).toContain(res.status);
    }
    // tenant table still intact after the SQL-injection-shaped attempts.
    expect(await tenantRow(victimTenantId)).not.toBeNull();
  }, 30000);

  it('rejects null tenantName with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: null, email: `null-name-${suffix}@example.com` }));
    expect([400, 422]).toContain(res.status);
  });

  it('rejects empty-string tenantName with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: '', email: `empty-name-${suffix}@example.com` }));
    expect([400, 422]).toContain(res.status);
  });

  it('rejects whitespace-only tenantName with a validation error', async () => {
    // FIX APPLIED: signupRequestSchema's tenantName is now
    // `z.string().trim().min(1).max(120)` (packages/contracts/src/auth.ts)
    // — a whitespace-only string trims to length 0 and is rejected. This
    // test previously documented the gap as an intentional failure; it now
    // asserts the fixed, secure behavior.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: '   ', email: `whitespace-name-${suffix}@example.com` }));
    expect([400, 422]).toContain(res.status);
  });

  it('rejects whitespace-only ownerName with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ ownerName: '   ', email: `whitespace-owner-${suffix}@example.com` }));
    expect([400, 422]).toContain(res.status);
  });

  it('a rejected whitespace-only signup creates zero rows — no user, tenant, membership, role, role_permission, or settings', async () => {
    const email = `whitespace-no-orphan-${suffix}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: '   ', email }));
    expect([400, 422]).toContain(res.status);

    // "user" is global/no-RLS — a plain query is authoritative on its own.
    const userCount = await platformPool.query(
      `SELECT count(*) FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    expect(Number(userCount.rows[0]!.count)).toBe(0);

    // No tenant/membership was ever created for this attempt (proven
    // below via the only identifiable link back to it: the owner email).
    // tenant_settings/role/role_permission all carry a tenant_id FK, so —
    // same reasoning as the "Attack G" rollback test above — if no tenant
    // row exists for this attempt, none of those could exist either.
    const tenantByOwnerEmail = await withGlobalTx(platformPool, { actorKind: 'platform' }, (tx) =>
      tx.query(
        `SELECT t.id FROM tenant t
           JOIN tenant_membership tm ON tm.tenant_id = t.id
           JOIN "user" u ON u.id = tm.user_id
          WHERE lower(u.email) = lower($1)`,
        [email],
      ),
    );
    expect(tenantByOwnerEmail.rows).toHaveLength(0);
  });

  it('trims surrounding whitespace and persists the trimmed value (verified in the database, not just the Zod parser)', async () => {
    const email = `trim-persist-${suffix}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(
        signupBody({
          tenantName: '  Trimmed Diner  ',
          ownerName: '  Trimmed Owner  ',
          email,
        }),
      );
    expect(res.status).toBe(200);
    // API response already reflects the trimmed value (Zod's parsed,
    // transformed output — not the raw request body).
    expect(res.body.memberships[0].tenantName).toBe('Trimmed Diner');
    const newTenantId = res.body.memberships[0].tenantId;

    const tenantRowAfter = await tenantRow(newTenantId);
    expect(tenantRowAfter?.name).toBe('Trimmed Diner');

    const userRow = await platformPool.query<{ full_name: string }>(
      `SELECT full_name FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    expect(userRow.rows[0]?.full_name).toBe('Trimmed Owner');
  });

  it('rejects null ownerName with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ ownerName: null, email: `null-owner-${suffix}@example.com` }));
    expect([400, 422]).toContain(res.status);
  });

  it('rejects empty-string email with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ email: '' }));
    expect([400, 422]).toContain(res.status);
  });

  it('rejects null password with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ password: null, email: `null-password-${suffix}@example.com` }));
    expect([400, 422]).toContain(res.status);
  });

  it('rejects/truncates extremely long field values without crashing', async () => {
    const longName = 'A'.repeat(10000);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ tenantName: longName, email: `long-${suffix}@example.com` }));
    // tenantName has an explicit max(120) in the contract -> validation failure.
    expect([400, 422]).toContain(res.status);
  });

  it('handles Unicode edge cases (emoji, zero-width, RTL override) without crashing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(
        signupBody({
          tenantName: '🍕 Ünïcödé ​‮ Diner',
          email: `unicode-${suffix}@example.com`,
        }),
      );
    expect(res.status).toBe(200);
    // Slug is still safely a-z0-9- only.
    expect(res.body.memberships[0].tenantSlug).toMatch(/^[a-z0-9-]+$/);
  });

  // ---------------------------------------------------------------------
  // Section 12: authentication / audience boundary
  // ---------------------------------------------------------------------

  it('a forged JWT with aud "platform" (correct secret, wrong audience) is rejected by tenant endpoints', async () => {
    const jwt = new JwtService();
    const forged = jwt.sign(
      { sub: victimUserId, rv: 1, aud: 'platform', jti: 'forged-1' },
      { secret: process.env['JWT_SECRET'], algorithm: 'HS256', expiresIn: '15m' },
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('a forged JWT with no aud claim at all (correct secret) is rejected by tenant endpoints', async () => {
    const jwt = new JwtService();
    const forged = jwt.sign(
      { sub: victimUserId, rv: 1, jti: 'forged-2' },
      { secret: process.env['JWT_SECRET'], algorithm: 'HS256', expiresIn: '15m' },
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('a signup-issued tenant token cannot select an arbitrary foreign membershipId', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody({ email: `select-tenant-attack-${suffix}@example.com` }));
    expect(res.status).toBe(200);

    const attempt = await request(app.getHttpServer())
      .post('/api/v1/auth/select-tenant')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .send({ membershipId: victimMembershipId });
    // Cross-tenant/foreign id -> 404, never 403 (architecture section 6.9),
    // and never a successful switch into the victim's tenant.
    expect(attempt.status).toBe(404);
  });

  // ---------------------------------------------------------------------
  // Section 14/15: concurrent same-key rate-limit proof
  // ---------------------------------------------------------------------

  it('concurrent requests against the SAME rate-limit key increment atomically (no lost updates)', async () => {
    await platformPool.query(
      `INSERT INTO public_rate_limit (key, window_start, count) VALUES ($1, now(), 0)
       ON CONFLICT (key) DO UPDATE SET window_start = now(), count = 0`,
      ['redteam:concurrency-probe'],
    );

    const { withGlobalTx } = await import('../../src/common/db/with-global-tx');
    const { PublicRateLimitRepository } =
      await import('../../src/modules/platform/public-rate-limit.repository');
    const repo = new PublicRateLimitRepository();

    const CONCURRENCY = 25;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        withGlobalTx(platformPool, { actorKind: 'platform' }, (tx) =>
          repo.touch(tx, 'redteam:concurrency-probe', 15),
        ),
      ),
    );
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    // Every one of the 25 concurrent increments must produce a distinct,
    // consecutive count (1..25) — any duplicate/gap means a lost update.
    expect(counts).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
  });
});
