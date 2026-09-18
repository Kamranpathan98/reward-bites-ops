/**
 * Gate 2 red-team fix: CORS was never configured (`app.enableCors()` was
 * never called), so no browser could actually call this API cross-origin
 * — which is every real deployment, including local dev (Vite on :5173,
 * Nest on :3000). This proves the fix the same way `main.ts` applies it
 * (`resolveCorsOrigins` -> `app.enableCors({ origin, credentials: true })`),
 * against a DB-free module (mirrors health.e2e-spec.ts), so it runs
 * without PostgreSQL.
 */
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from '../src/health/health.module';
import { resolveCorsOrigins } from '../src/common/config/cors';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'http://evil.example.com';

async function makeApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [HealthModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  const origins = resolveCorsOrigins({
    CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    NODE_ENV: 'production',
  });
  app.enableCors({ origin: origins, credentials: true });
  await app.init();
  return app;
}

describe('CORS (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reflects an allowed origin on a preflight (OPTIONS) request, with credentials allowed', async () => {
    const response = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('reflects an allowed origin on the actual GET response too', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does NOT reflect a disallowed origin on a preflight request', async () => {
    const response = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', DISALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does NOT reflect a disallowed origin on the actual GET response', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', DISALLOWED_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never configures a wildcard origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});
