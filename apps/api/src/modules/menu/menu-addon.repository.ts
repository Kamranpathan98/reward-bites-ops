import { Injectable } from '@nestjs/common';
import type { PatchAddonRequest } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface MenuAddonRow {
  id: string;
  tenantId: string;
  name: string;
  pricePaise: number;
  isAvailable: boolean;
  deletedAt: Date | null;
}

interface RawRow {
  id: string;
  tenant_id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  deleted_at: Date | null;
}

function mapRow(row: RawRow): MenuAddonRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    pricePaise: row.price_paise,
    isAvailable: row.is_available,
    deletedAt: row.deleted_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, name, price_paise, is_available, deleted_at`;

/**
 * `menu_addon` is tenant-scoped — every method here must run inside
 * `withTenantTx`. No per-tenant name-uniqueness is enforced (architecture
 * does not state one for this table, unlike category/item/variant).
 */
@Injectable()
export class MenuAddonRepository {
  async listForTenant(tx: TransactionContext, tenantId: string): Promise<MenuAddonRow[]> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_addon
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY name ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async listByIds(
    tx: TransactionContext,
    tenantId: string,
    ids: string[],
  ): Promise<MenuAddonRow[]> {
    if (ids.length === 0) return [];
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_addon
        WHERE tenant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return result.rows.map(mapRow);
  }

  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<MenuAddonRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_addon WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: { tenantId: string; name: string; pricePaise: number },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO menu_addon (id, tenant_id, name, price_paise) VALUES ($1, $2, $3, $4)`,
      [id, input.tenantId, input.name, input.pricePaise],
    );
    return { id };
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    patch: PatchAddonRequest,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    if (patch.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      values.push(patch.name);
    }
    if (patch.pricePaise !== undefined) {
      sets.push(`price_paise = $${paramIndex++}`);
      values.push(patch.pricePaise);
    }
    if (sets.length === 0) return;

    await tx.query(
      `UPDATE menu_addon SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      values,
    );
  }

  async softDelete(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE menu_addon SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
  }
}
