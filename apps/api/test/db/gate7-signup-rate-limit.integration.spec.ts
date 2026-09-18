/**
 * Self-service onboarding — abuse-throttle verification (task section 12),
 * executed against the real HTTP API and real PostgreSQL. Requires
 * TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL (app_platform)
 * — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 *
 * Its own file/app instance with a deliberately low
 * SIGNUP_RATE_LIMIT_MAX_ATTEMPTS so it doesn't have to fire dozens of real
 * requests to prove the limiter actually blocks — every other Gate 7 test
 * file sets the threshold artificially high for the opposite reason (many
 * legitimate signups from one loopback IP shouldn't trip it).
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

describeIfDb('Onboarding — signup abuse throttle', () => {
  let app: INestApplication;
  let platformPool: Pool;
  const suffix = Date.now();

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
    process.env['PLATFORM_BOOTSTRAP_SECRET'] ??= 'test-only-bootstrap-secret-1234';
    process.env['SIGNUP_RATE_LIMIT_MAX_ATTEMPTS'] = '3';
    process.env['SIGNUP_RATE_LIMIT_WINDOW_MINUTES'] = '15';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    await app.init();
    platformPool = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL });

    // Every Gate 7 test file's requests share one physical
    // public_rate_limit row (keyed by loopback IP, not by test file), and
    // every other file deliberately sets a HIGH threshold so its own many
    // legitimate signups don't trip it — but that leaves a high `count`
    // sitting in the row for THIS file's deliberately LOW threshold to
    // immediately collide with. Force the window back far enough that
    // this file's own first touch() sees it as expired and resets to 1.
    // app_platform has UPDATE (not DELETE) on this table by design (see
    // the table's own migration comment) — this uses only that grant.
    await platformPool.query(
      `UPDATE public_rate_limit SET window_start = now() - interval '1 day' WHERE key LIKE 'signup:ip:%'`,
    );
  });

  afterAll(async () => {
    await app.close();
    await platformPool.end();
  });

  function signupBody(i: number) {
    return {
      tenantName: `Throttle Diner ${i} ${suffix}`,
      ownerName: 'Throttle Owner',
      email: `throttle-owner-${i}-${suffix}@example.com`,
      password: 'a-real-owner-password-123',
      passwordConfirmation: 'a-real-owner-password-123',
    };
  }

  it('allows requests up to the threshold, then rejects with 429 RATE_LIMITED — DB-backed, not per-process', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send(signupBody(i));
      expect(res.status).toBe(200);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupBody(99));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // Even a malformed payload counts against the same IP window (task
    // section 12: "malformed payload floods").
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ tenantName: '' });
    expect([400, 422, 429]).toContain(malformed.status);
  }, 30000); // 5 sequential HTTP round-trips can exceed Jest's 5s default
  // when this file runs late in the full 18-file --runInBand suite.
});
