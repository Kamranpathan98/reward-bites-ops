import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface RawMembership {
  membershipId: string;
  tenantId: string;
  roleId: string;
  status: 'ACTIVE' | 'DISABLED';
}

export interface MembershipListRow {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  status: 'ACTIVE' | 'DISABLED';
  roleId: string;
  roleName: string;
  joinedAt: Date;
}

/** `tenant_membership` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class MembershipRepository {
  /**
   * All of a user's ACTIVE memberships, across every tenant they belong
   * to — used at login, before any single tenant context is known. Reads
   * `tenant_membership` alone (no join to `tenant`/`role`, which carry
   * their own stricter tenant-scoped policies and would filter this back
   * down to nothing): the RLS policy on `tenant_membership` itself has an
   * `OR user_id = app.user_id` clause specifically for this case (see
   * R__rls_policies.sql). Display info (tenant name, role name) is fetched
   * per-membership afterwards, each inside a real `withTenantTx` for that
   * membership's own tenant — see AuthService.login().
   */
  async findActiveByUserId(tx: TransactionContext, userId: string): Promise<RawMembership[]> {
    const result = await tx.query<{
      membership_id: string;
      tenant_id: string;
      role_id: string;
      status: 'ACTIVE' | 'DISABLED';
    }>(
      `SELECT id AS membership_id, tenant_id, role_id, status
         FROM tenant_membership
        WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    return result.rows.map((row) => ({
      membershipId: row.membership_id,
      tenantId: row.tenant_id,
      roleId: row.role_id,
      status: row.status,
    }));
  }

  /**
   * Looks up one membership by id, scoped by user_id rather than
   * tenant_id — used by `refresh()`, which only has `existing.userId` and
   * `existing.membershipId` from the refresh_token row, not a tenant
   * context. Relies on the same `OR user_id = app.user_id` RLS clause as
   * `findActiveByUserId`.
   */
  async findRawByIdForUser(
    tx: TransactionContext,
    membershipId: string,
    userId: string,
  ): Promise<RawMembership | null> {
    const result = await tx.query<{
      membership_id: string;
      tenant_id: string;
      role_id: string;
      status: 'ACTIVE' | 'DISABLED';
    }>(
      `SELECT id AS membership_id, tenant_id, role_id, status
         FROM tenant_membership
        WHERE id = $1 AND user_id = $2`,
      [membershipId, userId],
    );
    const row = result.rows[0];
    return row
      ? {
          membershipId: row.membership_id,
          tenantId: row.tenant_id,
          roleId: row.role_id,
          status: row.status,
        }
      : null;
  }

  async listForTenant(tx: TransactionContext, tenantId: string): Promise<MembershipListRow[]> {
    const result = await tx.query<{
      membership_id: string;
      user_id: string;
      email: string;
      full_name: string;
      status: 'ACTIVE' | 'DISABLED';
      role_id: string;
      role_name: string;
      joined_at: Date;
    }>(
      `SELECT tm.id AS membership_id, tm.user_id, u.email, u.full_name, tm.status,
              tm.role_id, r.name AS role_name, tm.joined_at
         FROM tenant_membership tm
         JOIN "user" u ON u.id = tm.user_id
         JOIN role r ON r.tenant_id = tm.tenant_id AND r.id = tm.role_id
        WHERE tm.tenant_id = $1
        ORDER BY tm.joined_at ASC`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      membershipId: row.membership_id,
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      roleId: row.role_id,
      roleName: row.role_name,
      joinedAt: row.joined_at,
    }));
  }

  async findRawById(
    tx: TransactionContext,
    tenantId: string,
    membershipId: string,
  ): Promise<{ id: string; userId: string; roleId: string; status: 'ACTIVE' | 'DISABLED' } | null> {
    const result = await tx.query<{
      id: string;
      user_id: string;
      role_id: string;
      status: 'ACTIVE' | 'DISABLED';
    }>(
      `SELECT id, user_id, role_id, status FROM tenant_membership WHERE tenant_id = $1 AND id = $2`,
      [tenantId, membershipId],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, userId: row.user_id, roleId: row.role_id, status: row.status }
      : null;
  }

  async findByTenantAndUser(
    tx: TransactionContext,
    tenantId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    const result = await tx.query<{ id: string }>(
      `SELECT id FROM tenant_membership WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    const row = result.rows[0];
    return row ? { id: row.id } : null;
  }

  async create(
    tx: TransactionContext,
    input: { tenantId: string; userId: string; roleId: string; invitedBy: string | null },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO tenant_membership (id, tenant_id, user_id, role_id, invited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.tenantId, input.userId, input.roleId, input.invitedBy],
    );
    return { id };
  }

  async updateRole(
    tx: TransactionContext,
    tenantId: string,
    membershipId: string,
    roleId: string,
  ): Promise<void> {
    await tx.query(`UPDATE tenant_membership SET role_id = $3 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      membershipId,
      roleId,
    ]);
  }

  async updateStatus(
    tx: TransactionContext,
    tenantId: string,
    membershipId: string,
    status: 'ACTIVE' | 'DISABLED',
  ): Promise<void> {
    await tx.query(`UPDATE tenant_membership SET status = $3 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      membershipId,
      status,
    ]);
  }
}
