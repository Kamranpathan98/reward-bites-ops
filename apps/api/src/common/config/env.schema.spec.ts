import { loadEnv } from './env.schema';

const REQUIRED = {
  DATABASE_URL: 'postgres://app_rw:pw@localhost:5432/rewardbite',
  PLATFORM_DATABASE_URL: 'postgres://app_platform:pw@localhost:5432/rewardbite',
  JWT_SECRET: 'a-test-secret-that-is-at-least-32-characters-long',
  PLATFORM_BOOTSTRAP_SECRET: 'a-test-bootstrap-secret',
};

describe('loadEnv', () => {
  it('parses a minimal valid environment with defaults applied', () => {
    const env = loadEnv({ ...REQUIRED });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(env.LOGIN_LOCKOUT_THRESHOLD).toBe(5);
  });

  it('coerces numeric env vars from strings', () => {
    const env = loadEnv({ ...REQUIRED, PORT: '4000', DB_POOL_MAX: '20' });

    expect(env.PORT).toBe(4000);
    expect(env.DB_POOL_MAX).toBe(20);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = REQUIRED;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('fails fast when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = REQUIRED;
    expect(() => loadEnv(rest)).toThrow(/JWT_SECRET/);
  });

  it('fails fast when JWT_SECRET is too short', () => {
    expect(() => loadEnv({ ...REQUIRED, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('fails fast when PLATFORM_DATABASE_URL is missing', () => {
    const { PLATFORM_DATABASE_URL: _omit, ...rest } = REQUIRED;
    expect(() => loadEnv(rest)).toThrow(/PLATFORM_DATABASE_URL/);
  });

  it('rejects an unknown NODE_ENV value', () => {
    expect(() => loadEnv({ ...REQUIRED, NODE_ENV: 'not-a-real-env' })).toThrow();
  });
});
