import { randomBytes } from 'node:crypto';

/**
 * A 256-bit random, URL-safe bearer token — used wherever a value needs to
 * be looked up directly (QR tokens embedded in printed codes, session
 * tokens embedded in a customer's status-page URL), unlike a refresh token
 * (common/security/refresh-token.ts), which is deliberately hashed at rest
 * because it is never looked up by anything other than the request that
 * already holds it.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
