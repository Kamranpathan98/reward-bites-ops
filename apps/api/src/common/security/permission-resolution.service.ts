import { Inject, Injectable } from '@nestjs/common';
import { DB_POOL, withTenantTx, type Pool } from '../db';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * Backs both `AuthGuard`'s `rv` check and `PermissionGuard`'s permission
 * check (architecture section 7): the membership's permission set is
 * cached 60s per membership; a user's `security_version` is cached 60s
 * per user. Both caches are plain in-memory maps — no Redis (architecture
 * explicitly excludes it) — which is correct because they're per-process,
 * best-effort optimisations: worst case a change takes up to 60s to be
 * felt, which is the architecture's own stated bound ("dies within a
 * minute").
 *
 * `getCurrentSecurityVersion` reads the global `user` table directly
 * (no RLS applies to it — see R__rls_policies.sql). `getPermissionsForMembership`
 * reads tenant-scoped `role_permission` through `withTenantTx`, since RLS
 * does apply there.
 */
@Injectable()
export class PermissionResolutionService {
  private readonly securityVersionCache = new Map<string, CacheEntry<number>>();
  private readonly permissionSetCache = new Map<string, CacheEntry<Set<string>>>();

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async getCurrentSecurityVersion(userId: string): Promise<number | null> {
    const now = Date.now();
    const cached = this.securityVersionCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const result = await this.pool.query<{ security_version: number }>(
      `SELECT security_version FROM "user" WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;

    this.securityVersionCache.set(userId, {
      value: row.security_version,
      expiresAt: now + CACHE_TTL_MS,
    });
    return row.security_version;
  }

  invalidateSecurityVersion(userId: string): void {
    this.securityVersionCache.delete(userId);
  }

  async getPermissionsForMembership(tenantId: string, membershipId: string): Promise<Set<string>> {
    const now = Date.now();
    const cacheKey = `${tenantId}:${membershipId}`;
    const cached = this.permissionSetCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const permissions = await withTenantTx(
      this.pool,
      { tenantId, actorKind: 'staff' },
      async (tx) => {
        const result = await tx.query<{ permission_key: string }>(
          `SELECT rp.permission_key
           FROM tenant_membership tm
           JOIN role_permission rp ON rp.tenant_id = tm.tenant_id AND rp.role_id = tm.role_id
          WHERE tm.id = $1 AND tm.tenant_id = $2 AND tm.status = 'ACTIVE'`,
          [membershipId, tenantId],
        );
        return new Set(result.rows.map((row) => row.permission_key));
      },
    );

    this.permissionSetCache.set(cacheKey, { value: permissions, expiresAt: now + CACHE_TTL_MS });
    return permissions;
  }

  invalidatePermissions(tenantId: string, membershipId: string): void {
    this.permissionSetCache.delete(`${tenantId}:${membershipId}`);
  }
}
