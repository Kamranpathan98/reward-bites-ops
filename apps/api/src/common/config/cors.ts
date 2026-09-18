import type { Env } from './env.schema';

/**
 * Gate 2 red-team fix: CORS was never configured at all, so the browser
 * frontend (a different origin from the API in every real deployment —
 * architecture section 15, "CORS: allow http://localhost:5173" in
 * development, "allow https://app.<domain> only" in staging/production)
 * could not actually call the API. This resolves the exact-origin
 * allow-list `app.enableCors()` needs.
 *
 * Never returns `'*'`. `CORS_ALLOWED_ORIGINS` (comma-separated) is the
 * source of truth in every environment where it's set; development falls
 * back to the architecture's own stated local Vite origin so `npm run
 * dev:api` + `npm run dev:web` work out of the box. Outside development
 * with no explicit allow-list, this returns an empty list — fail closed,
 * never open.
 */
export function resolveCorsOrigins(env: Pick<Env, 'CORS_ALLOWED_ORIGINS' | 'NODE_ENV'>): string[] {
  if (env.CORS_ALLOWED_ORIGINS) {
    return env.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  return env.NODE_ENV === 'development' ? ['http://localhost:5173'] : [];
}
