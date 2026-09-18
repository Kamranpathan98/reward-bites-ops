import { Injectable } from '@nestjs/common';
import type { PatchCategoryRequest } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface MenuCategoryRow {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  deletedAt: Date | null;
}

interface RawRow {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  deleted_at: Date | null;
}

function mapRow(row: RawRow): MenuCategoryRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    deletedAt: row.deleted_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, name, sort_order, is_active, deleted_at`;

/** `menu_category` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class MenuCategoryRepository {
  async listForTenant(tx: TransactionContext, tenantId: string): Promise<MenuCategoryRow[]> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_category
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
  ): Promise<MenuCategoryRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_category WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findActiveByName(
    tx: TransactionContext,
    tenantId: string,
    name: string,
  ): Promise<MenuCategoryRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM menu_category
        WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, name],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: { tenantId: string; name: string; sortOrder: number },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO menu_category (id, tenant_id, name, sort_order) VALUES ($1, $2, $3, $4)`,
      [id, input.tenantId, input.name, input.sortOrder],
    );
    return { id };
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    patch: PatchCategoryRequest,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    if (patch.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      values.push(patch.name);
    }
    if (patch.sortOrder !== undefined) {
      sets.push(`sort_order = $${paramIndex++}`);
      values.push(patch.sortOrder);
    }
    if (patch.isActive !== undefined) {
      sets.push(`is_active = $${paramIndex++}`);
      values.push(patch.isActive);
    }
    if (sets.length === 0) return;

    await tx.query(
      `UPDATE menu_category SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      values,
    );
  }

  async softDelete(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE menu_category SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
  }

  async hasActiveItems(tx: TransactionContext, tenantId: string, id: string): Promise<boolean> {
    const result = await tx.query(
      `SELECT 1 FROM menu_item WHERE tenant_id = $1 AND category_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, id],
    );
    return result.rows.length > 0;
  }

  async reorder(tx: TransactionContext, tenantId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.query(`UPDATE menu_category SET sort_order = $3 WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        orderedIds[i],
        i,
      ]);
    }
  }
}
