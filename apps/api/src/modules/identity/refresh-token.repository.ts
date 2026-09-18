import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface RefreshTokenRow {
  id: string;
  userId: string;
  membershipId: string | null;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

interface RefreshTokenSqlRow {
  id: string;
  user_id: string;
  membership_id: string | null;
  token_hash: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

function mapRow(row: RefreshTokenSqlRow): RefreshTokenRow {
  return {
    id: row.id,
    userId: row.user_id,
    membershipId: row.membership_id,
    tokenHash: row.token_hash,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedBy: row.replaced_by,
  };
}

/** `refresh_token` is global (no tenant_id) — see R__rls_policies.sql. */
@Injectable()
export class RefreshTokenRepository {
  async create(
    tx: TransactionContext,
    input: {
      userId: string;
      membershipId: string | null;
      tokenHash: string;
      familyId?: string | undefined;
      ttlDays: number;
      deviceLabel?: string | null | undefined;
      ip?: string | null | undefined;
      userAgent?: string | null | undefined;
    },
  ): Promise<RefreshTokenRow> {
    const id = newId();
    const familyId = input.familyId ?? randomUUID();
    const result = await tx.query<RefreshTokenSqlRow>(
      `INSERT INTO refresh_token
         (id, user_id, membership_id, token_hash, family_id, expires_at, device_label, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval, $7, $8, $9)
       RETURNING *`,
      [
        id,
        input.userId,
        input.membershipId,
        input.tokenHash,
        familyId,
        input.ttlDays,
        input.deviceLabel ?? null,
        input.ip ?? null,
        input.userAgent ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSERT into refresh_token returned no row');
    return mapRow(row);
  }

  async findByHash(tx: TransactionContext, tokenHash: string): Promise<RefreshTokenRow | null> {
    const result = await tx.query<RefreshTokenSqlRow>(
      `SELECT * FROM refresh_token WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async markRevoked(
    tx: TransactionContext,
    id: string,
    replacedById: string | null,
  ): Promise<void> {
    await tx.query(`UPDATE refresh_token SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [
      id,
      replacedById,
    ]);
  }

  /** Reuse detection / logout: revoke every non-revoked token in a family. */
  async revokeFamily(tx: TransactionContext, familyId: string): Promise<void> {
    await tx.query(
      `UPDATE refresh_token SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }

  /**
   * `DELETE /users/:membershipId/sessions` — scoped to sessions bound to
   * THIS membership only. A user who belongs to more than one tenant keeps
   * their other tenants' sessions alive; an admin in tenant A revoking a
   * member's sessions must never be able to sign that user out of tenant B.
   */
  async revokeAllForMembership(tx: TransactionContext, membershipId: string): Promise<void> {
    await tx.query(
      `UPDATE refresh_token SET revoked_at = now() WHERE membership_id = $1 AND revoked_at IS NULL`,
      [membershipId],
    );
  }
}
