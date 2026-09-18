/**
 * What `AuthGuard` attaches to the request after verifying the JWT.
 * `tenantId`/`membershipId` are present only for a tenant-bound token —
 * `TenantGuard` is what actually requires and relies on them.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly tenantId: string | null;
  readonly membershipId: string | null;
  readonly securityVersion: number;
  readonly jti: string;
}

declare module 'express' {
  interface Request {
    authUser?: AuthenticatedUser;
  }
}
