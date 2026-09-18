import { Injectable } from '@nestjs/common';
import type { PatchVariantRequest } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface MenuVariantRow {
  id: string;
  tenantId: string;
  itemId: string;
  name: string;
  pricePaise: number;
  isAvailable: boolean;
  sortOrder: number;
  deletedAt: Date | null;
}

interface RawRow {
  id: string;
  tenant_id: string;
  item_id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  sort_order: number;
  deleted_at: Date | null;
}

function mapRow(row: RawRow): MenuVariantRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    itemId: row.item_id,
    name: row.name,
    pricePaise: row.price_paise,
    isAvailable: row.is_available,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, item_id, name, price_paise, is_available, sort_order, deleted_at`;

/** `menu_variant` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class MenuVariantRepository {
  async listForTenant(tx: TransactionContext, tenantId: string): Promise<MenuVariantRow[]> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_variant
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async listActiveForItems(
    tx: TransactionContext,
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, MenuVariantRow[]>> {
    if (itemIds.length === 0) return new Map();
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_variant
        WHERE tenant_id = $1 AND deleted_at IS NULL AND item_id = ANY($2::uuid[])
        ORDER BY sort_order ASC, name ASC`,
      [tenantId, itemIds],
    );
    const map = new Map<string, MenuVariantRow[]>();
    for (const row of result.rows) {
      const mapped = mapRow(row);
      const list = map.get(mapped.itemId) ?? [];
      list.push(mapped);
      map.set(mapped.itemId, list);
    }
    return map;
  }

  async countActiveForItem(
    tx: TransactionContext,
    tenantId: string,
    itemId: string,
  ): Promise<number> {
    const result = await tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM menu_variant WHERE tenant_id = $1 AND item_id = $2 AND deleted_at IS NULL`,
      [tenantId, itemId],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<MenuVariantRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_variant WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findActiveByItemAndName(
    tx: TransactionContext,
    tenantId: string,
    itemId: string,
    name: string,
  ): Promise<MenuVariantRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_variant
        WHERE tenant_id = $1 AND item_id = $2 AND name = $3 AND deleted_at IS NULL`,
      [tenantId, itemId, name],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: {
      tenantId: string;
      itemId: string;
      name: string;
      pricePaise: number;
      sortOrder: number;
    },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO menu_variant (id, tenant_id, item_id, name, price_paise, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.tenantId, input.itemId, input.name, input.pricePaise, input.sortOrder],
    );
    return { id };
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    patch: PatchVariantRequest,
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
    if (patch.sortOrder !== undefined) {
      sets.push(`sort_order = $${paramIndex++}`);
      values.push(patch.sortOrder);
    }
    if (sets.length === 0) return;

    await tx.query(
      `UPDATE menu_variant SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      values,
    );
  }

  async updateAvailability(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    isAvailable: boolean,
  ): Promise<void> {
    await tx.query(`UPDATE menu_variant SET is_available = $3 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
      isAvailable,
    ]);
  }

  async softDelete(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE menu_variant SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
  }

  async softDeleteAllForItem(
    tx: TransactionContext,
    tenantId: string,
    itemId: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE menu_variant SET deleted_at = now()
        WHERE tenant_id = $1 AND item_id = $2 AND deleted_at IS NULL`,
      [tenantId, itemId],
    );
  }
}
