import { resolveCorsOrigins } from './cors';

describe('resolveCorsOrigins (Gate 2 red-team fix)', () => {
  it('parses a comma-separated allow-list, trimming whitespace', () => {
    const origins = resolveCorsOrigins({
      CORS_ALLOWED_ORIGINS:
        'https://app.example.com, https://app2.example.com ,https://app3.example.com',
      NODE_ENV: 'production',
    });
    expect(origins).toEqual([
      'https://app.example.com',
      'https://app2.example.com',
      'https://app3.example.com',
    ]);
  });

  it('handles a single origin with no commas', () => {
    const origins = resolveCorsOrigins({
      CORS_ALLOWED_ORIGINS: 'https://app.example.com',
      NODE_ENV: 'staging',
    });
    expect(origins).toEqual(['https://app.example.com']);
  });

  it('drops empty entries from a trailing/stray comma', () => {
    const origins = resolveCorsOrigins({
      CORS_ALLOWED_ORIGINS: 'https://app.example.com,,',
      NODE_ENV: 'production',
    });
    expect(origins).toEqual(['https://app.example.com']);
  });

  it('falls back to the architecture-stated local Vite origin in development when unset', () => {
    const origins = resolveCorsOrigins({
      CORS_ALLOWED_ORIGINS: undefined,
      NODE_ENV: 'development',
    });
    expect(origins).toEqual(['http://localhost:5173']);
  });

  it('fails closed (empty list, never "*") outside development when unset', () => {
    expect(resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: undefined, NODE_ENV: 'production' })).toEqual(
      [],
    );
    expect(resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: undefined, NODE_ENV: 'staging' })).toEqual(
      [],
    );
  });

  it('an explicit allow-list always wins over the development default', () => {
    const origins = resolveCorsOrigins({
      CORS_ALLOWED_ORIGINS: 'https://staging.example.com',
      NODE_ENV: 'development',
    });
    expect(origins).toEqual(['https://staging.example.com']);
  });

  it('never synthesizes a wildcard when nothing is configured', () => {
    // The only two possible outputs with no env input are the fixed
    // development default and an empty (fail-closed) list — neither path
    // can ever produce '*'.
    expect(
      resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: undefined, NODE_ENV: 'development' }),
    ).not.toContain('*');
    expect(
      resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: undefined, NODE_ENV: 'production' }),
    ).not.toContain('*');
  });
});
