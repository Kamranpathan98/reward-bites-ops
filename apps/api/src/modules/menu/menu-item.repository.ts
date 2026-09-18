import { Injectable } from '@nestjs/common';
import type { PatchItemRequest, VegFlag } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface MenuItemRow {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageKey: string | null;
  basePricePaise: number | null;
  isAvailable: boolean;
  isActive: boolean;
  sortOrder: number;
  vegFlag: VegFlag | null;
  deletedAt: Date | null;
}

interface RawRow {
  id: string;
  tenant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  image_key: string | null;
  base_price_paise: number | null;
  is_available: boolean;
  is_active: boolean;
  sort_order: number;
  veg_flag: VegFlag | null;
  deleted_at: Date | null;
}

function mapRow(row: RawRow): MenuItemRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageKey: row.image_key,
    basePricePaise: row.base_price_paise,
    isAvailable: row.is_available,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    vegFlag: row.veg_flag,
    deletedAt: row.deleted_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, category_id, name, description, image_key, base_price_paise, is_available, is_active, sort_order, veg_flag, deleted_at`;

/** `menu_item` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class MenuItemRepository {
  async listForTenant(tx: TransactionContext, tenantId: string): Promise<MenuItemRow[]> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_item
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<MenuItemRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_item WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findActiveByCategoryAndName(
    tx: TransactionContext,
    tenantId: string,
    categoryId: string,
    name: string,
  ): Promise<MenuItemRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_item
        WHERE tenant_id = $1 AND category_id = $2 AND name = $3 AND deleted_at IS NULL`,
      [tenantId, categoryId, name],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: {
      tenantId: string;
      categoryId: string;
      name: string;
      description: string | null;
      basePricePaise: number | null;
      sortOrder: number;
      vegFlag: VegFlag | null;
    },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO menu_item
         (id, tenant_id, category_id, name, description, base_price_paise, sort_order, veg_flag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.tenantId,
        input.categoryId,
        input.name,
        input.description,
        input.basePricePaise,
        input.sortOrder,
        input.vegFlag,
      ],
    );
    return { id };
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    patch: PatchItemRequest,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };

    if (patch.categoryId !== undefined) push('category_id', patch.categoryId);
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.basePricePaise !== undefined) push('base_price_paise', patch.basePricePaise);
    if (patch.sortOrder !== undefined) push('sort_order', patch.sortOrder);
    if (patch.vegFlag !== undefined) push('veg_flag', patch.vegFlag);
    if (patch.isActive !== undefined) push('is_active', patch.isActive);
    if (sets.length === 0) return;

    await tx.query(
      `UPDATE menu_item SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      values,
    );
  }

  async updateAvailability(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    isAvailable: boolean,
  ): Promise<void> {
    await tx.query(`UPDATE menu_item SET is_available = $3 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
      isAvailable,
    ]);
  }

  async softDelete(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE menu_item SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
  }

  async reorderWithinCategory(
    tx: TransactionContext,
    tenantId: string,
    categoryId: string,
    orderedIds: string[],
  ): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.query(
        `UPDATE menu_item SET sort_order = $4
          WHERE tenant_id = $1 AND category_id = $2 AND id = $3`,
        [tenantId, categoryId, orderedIds[i], i],
      );
    }
  }
}
