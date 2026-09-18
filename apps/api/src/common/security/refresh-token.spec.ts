import { generateRefreshToken, hashRefreshToken } from './refresh-token';

describe('refresh token generation', () => {
  it('generates a URL-safe, sufficiently long random token', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes, base64url-encoded, is at least 42 characters.
    expect(token.length).toBeGreaterThanOrEqual(42);
  });

  it('generates a different token on every call', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(20);
  });

  it('hashes deterministically (same input -> same hash)', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    const hash = hashRefreshToken('some-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never stores the raw token as its own hash', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).not.toBe(token);
  });
});
