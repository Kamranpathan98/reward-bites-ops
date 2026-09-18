import { z } from 'zod';

/**
 * Startup env validation. Only variables actually consumed by code that
 * exists so far are required; the rest of the `.env.example` catalogue
 * (CORS, R2, Sentry, ...) is validated loosely here so the schema doesn't
 * drift from `.env.example`, but nothing beyond DB/app/JWT basics is
 * enforced until the modules that consume it exist (see
 * docs/IMPLEMENTATION_STATUS.md).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (app_rw connection string)'),
  MIGRATION_DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Not part of the blueprint's original `.env.example` catalogue — added
  // in Gate 2 for the same reason MIGRATION_DATABASE_URL is separate from
  // DATABASE_URL: `POST /platform/tenants` must run as the app_platform
  // role, never app_rw, and Postgres roles need their own connection
  // string. See docs/IMPLEMENTATION_STATUS.md for the full note.
  PLATFORM_DATABASE_URL: z
    .string()
    .min(1, 'PLATFORM_DATABASE_URL is required (app_platform connection string)'),
  // Temporary stand-in for full platform_admin JWT auth (not built this
  // gate — see docs/IMPLEMENTATION_STATUS.md). Guards POST /platform/tenants only.
  PLATFORM_BOOTSTRAP_SECRET: z
    .string()
    .min(16, 'PLATFORM_BOOTSTRAP_SECRET must be at least 16 characters'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters (256-bit secret, HS256)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CORS_ALLOWED_ORIGINS: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  SENTRY_DSN_API: z.string().optional(),

  ARGON2_MEMORY_KB: z.coerce.number().int().positive().default(65536),
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  // Self-service signup abuse throttle (onboarding task section 12) —
  // same per-IP-window shape as LOGIN_LOCKOUT_THRESHOLD above, configurable
  // for the same reason: the DB integration suite exercises many signups
  // from one loopback IP and would otherwise trip its own rate limit.
  SIGNUP_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SIGNUP_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  FEATURE_KITCHEN_DISPLAY: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
