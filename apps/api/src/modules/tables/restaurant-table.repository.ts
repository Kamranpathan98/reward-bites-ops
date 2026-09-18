import { Injectable } from '@nestjs/common';
import type { PatchTableRequest } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface RestaurantTableRow {
  id: string;
  tenantId: string;
  name: string;
  displayOrder: number;
  capacity: number | null;
  isActive: boolean;
  deletedAt: Date | null;
}

interface RawRow {
  id: string;
  tenant_id: string;
  name: string;
  display_order: number;
  capacity: number | null;
  is_active: boolean;
  deleted_at: Date | null;
}

function mapRow(row: RawRow): RestaurantTableRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    displayOrder: row.display_order,
    capacity: row.capacity,
    isActive: row.is_active,
    deletedAt: row.deleted_at,
  };
}

/** `restaurant_table` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class RestaurantTableRepository {
  async listForTenant(tx: TransactionContext, tenantId: string): Promise<RestaurantTableRow[]> {
    const result = await tx.query<RawRow>(
      `SELECT id, tenant_id, name, display_order, capacity, is_active, deleted_at
         FROM restaurant_table
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY display_order ASC, name ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<RestaurantTableRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT id, tenant_id, name, display_order, capacity, is_active, deleted_at
         FROM restaurant_table
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findActiveByName(
    tx: TransactionContext,
    tenantId: string,
    name: string,
  ): Promise<RestaurantTableRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT id, tenant_id, name, display_order, capacity, is_active, deleted_at
         FROM restaurant_table
        WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, name],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: { tenantId: string; name: string; displayOrder: number; capacity: number | null },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO restaurant_table (id, tenant_id, name, display_order, capacity)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.tenantId, input.name, input.displayOrder, input.capacity],
    );
    return { id };
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    patch: PatchTableRequest,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    if (patch.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      values.push(patch.name);
    }
    if (patch.displayOrder !== undefined) {
      sets.push(`display_order = $${paramIndex++}`);
      values.push(patch.displayOrder);
    }
    if (patch.capacity !== undefined) {
      sets.push(`capacity = $${paramIndex++}`);
      values.push(patch.capacity);
    }
    if (patch.isActive !== undefined) {
      sets.push(`is_active = $${paramIndex++}`);
      values.push(patch.isActive);
    }
    if (sets.length === 0) return;

    // `updated_at` itself is bumped by the generic set_updated_at trigger
    // (R__triggers.sql), not written here — same convention as every other
    // module's repositories.
    await tx.query(
      `UPDATE restaurant_table SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2`,
      values,
    );
  }

  async softDelete(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(
      `UPDATE restaurant_table SET deleted_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
  }
}
