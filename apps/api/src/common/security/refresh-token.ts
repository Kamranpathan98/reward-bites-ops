import { createHash, randomBytes } from 'node:crypto';

/**
 * Architecture section 7: refresh token is 256-bit random, stored hashed
 * (SHA-256) in `refresh_token`. The raw value is the bearer credential —
 * it is set in the HttpOnly cookie and never persisted; only its hash is.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
