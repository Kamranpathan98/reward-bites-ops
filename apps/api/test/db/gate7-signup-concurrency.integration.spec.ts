/**
 * Self-service onboarding — concurrent signup and rollback verification
 * (task sections 23-24 / Attacks F-G), executed against the real HTTP API
 * and real PostgreSQL. Requires TEST_DATABASE_URL (app_rw) and
 * TEST_PLATFORM_DATABASE_URL (app_platform) — see docs/DEVELOPMENT.md.
 * Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { withGlobalTx } from '../../src/common/db/with-global-tx';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

describeIfDb('Onboarding — concurrent signup and rollback verification', () => {
  let app: INestApplication;
  let platformPool: Pool;
  const suffix = Date.now();

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
    process.env['PLATFORM_BOOTSTRAP_SECRET'] ??= 'test-only-bootstrap-secret-1234';
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

  it('Attack F: N concurrent signups for the SAME email -> exactly one succeeds, database arbitrates', async () => {
    // The platform pool is deliberately capped at max: 2 in production
    // (platform-db.module.ts — provisioning is rare, no need for a bigger
    // pool there); 10 concurrent full transactional attempts genuinely
    // take longer than Jest's 5s default when serialized through that
    // cap. A test-only timeout, not a production pool-size change.
    const email = `concurrent-email-${suffix}@example.com`;
    const CONCURRENCY = 10;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/signup')
          .send({
            tenantName: `Concurrent Diner ${i} ${suffix}`,
            ownerName: 'Racer',
            email,
            password: 'a-real-owner-password-123',
            passwordConfirmation: 'a-real-owner-password-123',
          }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(CONCURRENCY - 1);

    // "user" has no tenant_id and no RLS (global table) — a plain query
    // is fine. tenant_membership DOES have RLS with no platform-actor-kind
    // bypass clause (only tenant_id or user_id match, see
    // R__rls_policies.sql) — it needs app.user_id set to the real user's
    // id, the same established pattern rls-tenant-membership.integration
    // .spec.ts already uses for exactly this reason.
    const userRow = await platformPool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    expect(userRow.rows).toHaveLength(1);
    const userId = userRow.rows[0]!.id;

    const membershipCount = await withGlobalTx(
      platformPool,
      { userId, actorKind: 'platform' },
      (tx) =>
        tx.query<{ count: string }>(`SELECT count(*) FROM tenant_membership WHERE user_id = $1`, [
          userId,
        ]),
    );
    expect(Number(membershipCount.rows[0]!.count)).toBe(1);
  }, 30000);

  it('N concurrent signups for the SAME restaurant name (different emails) all succeed with distinct slugs', async () => {
    // Same platform-pool-cap reasoning as the previous test, compounded by
    // every one of these 8 actually succeeding (full transactional writes,
    // no fast pre-check rejections) plus some needing a slug-retry.
    const name = `Concurrent Name Diner ${suffix}`;
    const CONCURRENCY = 8;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/signup')
          .send({
            tenantName: name,
            ownerName: 'Racer',
            email: `concurrent-name-${i}-${suffix}@example.com`,
            password: 'a-real-owner-password-123',
            passwordConfirmation: 'a-real-owner-password-123',
          }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(CONCURRENCY);

    const slugs = succeeded.map((r) => r.body.memberships[0].tenantSlug);
    expect(new Set(slugs).size).toBe(CONCURRENCY); // every slug unique, none dropped/overwritten

    // tenant's RLS policy allows app.actor_kind = 'platform' with no
    // tenant_id needed (R__rls_policies.sql) — withGlobalTx alone suffices.
    const tenantCount = await withGlobalTx(platformPool, { actorKind: 'platform' }, (tx) =>
      tx.query<{ count: string }>(`SELECT count(*) FROM tenant WHERE slug = ANY($1)`, [slugs]),
    );
    expect(Number(tenantCount.rows[0]!.count)).toBe(CONCURRENCY);
  }, 30000);

  it('Attack G: a failure partway through provisioning leaves zero orphan rows (real transaction rollback)', async () => {
    // A genuine, realistic mid-transaction failure: provisionTenant already
    // wrote tenant/tenant_settings/role/role_permission rows for this
    // attempt (inside the one transaction) by the time it reaches the
    // owner-email check and throws — exactly the "after role creation"
    // failure point the task asks for, produced by real application logic
    // rather than an injected test-only fault.
    const email = `rollback-existing-${suffix}@example.com`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: `Rollback Seed ${suffix}`,
        ownerName: 'Seed Owner',
        email,
        password: 'a-real-owner-password-123',
        passwordConfirmation: 'a-real-owner-password-123',
      });
    expect(first.status).toBe(200);

    const failingTenantName = `Rollback Attempt ${suffix}`;
    const second = await request(app.getHttpServer()).post('/api/v1/auth/signup').send({
      tenantName: failingTenantName,
      ownerName: 'Second Owner',
      email, // already exists -> throws deep inside the transaction
      password: 'a-different-password-456',
      passwordConfirmation: 'a-different-password-456',
    });
    expect(second.status).toBe(409);

    // No orphan tenant, settings, roles, role_permission, or membership
    // rows were left behind by the failed attempt. Checking `tenant` alone
    // is sufficient proof of full rollback: role/tenant_settings/
    // role_permission all carry a tenant_id FK to tenant(id), so if no
    // tenant row exists for the failed attempt, none of those could exist
    // either — no need to separately query role under its own (narrower,
    // single-tenant-scoped) RLS policy.
    const expectedSlug = 'rollback-attempt-' + suffix;
    const tenant = await withGlobalTx(platformPool, { actorKind: 'platform' }, (tx) =>
      tx.query(`SELECT id FROM tenant WHERE slug LIKE $1`, [`${expectedSlug}%`]),
    );
    expect(tenant.rows).toHaveLength(0);

    // The original (first) owner's account is completely unaffected.
    const userCount = await platformPool.query(
      `SELECT count(*) FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    expect(Number(userCount.rows[0].count)).toBe(1);
  });
});
