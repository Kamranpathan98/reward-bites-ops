import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
}

/** `role` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class RoleRepository {
  async listForTenant(tx: TransactionContext): Promise<RoleRow[]> {
    const result = await tx.query<{ id: string; name: string; is_system: boolean }>(
      `SELECT id, name, is_system FROM role WHERE tenant_id = $1 ORDER BY name ASC`,
      [tx.tenantId],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, isSystem: row.is_system }));
  }

  async findById(tx: TransactionContext, roleId: string): Promise<RoleRow | null> {
    const result = await tx.query<{ id: string; name: string; is_system: boolean }>(
      `SELECT id, name, is_system FROM role WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, roleId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, isSystem: row.is_system } : null;
  }

  /** Used only by platform tenant-provisioning (system role templates). */
  async create(
    tx: TransactionContext,
    tenantId: string,
    name: string,
    isSystem: boolean,
  ): Promise<RoleRow> {
    const id = newId();
    await tx.query(`INSERT INTO role (id, tenant_id, name, is_system) VALUES ($1, $2, $3, $4)`, [
      id,
      tenantId,
      name,
      isSystem,
    ]);
    return { id, name, isSystem };
  }
}
