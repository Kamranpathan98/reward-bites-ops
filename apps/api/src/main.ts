import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import type { Pool } from 'pg';
import { AppModule } from './app.module';
import { ConfigService } from './common/config/config.service';
import { resolveCorsOrigins } from './common/config/cors';
import { assertNoBypassRls } from './common/db';
import { DB_POOL } from './common/db/db.module';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(cookieParser());

  // Gate 2 red-team fix: CORS was never configured, so the browser
  // frontend — a different origin from the API in dev (different port)
  // and in every real deployment (different domain) — could not actually
  // call it. Exact allow-list from CORS_ALLOWED_ORIGINS (architecture
  // section 7/15); never '*'.
  const config = app.get(ConfigService);
  const corsOrigins = resolveCorsOrigins(config.env);
  if (corsOrigins.length === 0 && config.env.NODE_ENV !== 'development') {
    console.warn(
      'CORS_ALLOWED_ORIGINS is not set — no browser origin will be able to call this API.',
    );
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // "REST under /api/v1" (architecture section 12). /health is excluded —
  // it's the ops liveness/readiness check, listed separately from the
  // tenant/platform/public route prefixes in the same section.
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  // Startup security check (blueprint section 16): refuse to serve traffic
  // if app_rw can bypass RLS.
  const pool = app.get<Pool>(DB_POOL);
  await assertNoBypassRls(pool);

  await app.listen(config.env.PORT);
  console.log(`RewardBite API listening on port ${config.env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during API startup:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
