import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface OrderLineRow {
  id: string;
  tenantId: string;
  orderId: string;
  menuItemId: string;
  menuVariantId: string | null;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  unitPricePaise: number;
  qty: number;
  lineTotalPaise: number;
  notes: string | null;
  status: 'ACTIVE' | 'REMOVED';
  removedAt: Date | null;
  removedBy: string | null;
  sortOrder: number;
}

interface RawRow {
  id: string;
  tenant_id: string;
  order_id: string;
  menu_item_id: string;
  menu_variant_id: string | null;
  item_name_snapshot: string;
  variant_name_snapshot: string | null;
  unit_price_paise: string;
  qty: number;
  line_total_paise: string;
  notes: string | null;
  status: 'ACTIVE' | 'REMOVED';
  removed_at: Date | null;
  removed_by: string | null;
  sort_order: number;
}

function mapRow(row: RawRow): OrderLineRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    menuItemId: row.menu_item_id,
    menuVariantId: row.menu_variant_id,
    itemNameSnapshot: row.item_name_snapshot,
    variantNameSnapshot: row.variant_name_snapshot,
    unitPricePaise: Number(row.unit_price_paise),
    qty: row.qty,
    lineTotalPaise: Number(row.line_total_paise),
    notes: row.notes,
    status: row.status,
    removedAt: row.removed_at,
    removedBy: row.removed_by,
    sortOrder: row.sort_order,
  };
}

const SELECT_COLUMNS = `id, tenant_id, order_id, menu_item_id, menu_variant_id, item_name_snapshot,
  variant_name_snapshot, unit_price_paise, qty, line_total_paise, notes, status, removed_at,
  removed_by, sort_order`;

/** `order_line` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class OrderLineRepository {
  async listForOrders(
    tx: TransactionContext,
    tenantId: string,
    orderIds: string[],
  ): Promise<Map<string, OrderLineRow[]>> {
    if (orderIds.length === 0) return new Map();
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM order_line
        WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
        ORDER BY sort_order ASC, id ASC`,
      [tenantId, orderIds],
    );
    const map = new Map<string, OrderLineRow[]>();
    for (const row of result.rows) {
      const mapped = mapRow(row);
      const list = map.get(mapped.orderId) ?? [];
      list.push(mapped);
      map.set(mapped.orderId, list);
    }
    return map;
  }

  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<OrderLineRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM order_line WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: {
      tenantId: string;
      orderId: string;
      menuItemId: string;
      menuVariantId: string | null;
      itemNameSnapshot: string;
      variantNameSnapshot: string | null;
      unitPricePaise: number;
      qty: number;
      notes: string | null;
      sortOrder: number;
    },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO order_line
         (id, tenant_id, order_id, menu_item_id, menu_variant_id, item_name_snapshot,
          variant_name_snapshot, unit_price_paise, qty, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        input.tenantId,
        input.orderId,
        input.menuItemId,
        input.menuVariantId,
        input.itemNameSnapshot,
        input.variantNameSnapshot,
        input.unitPricePaise,
        input.qty,
        input.notes,
        input.sortOrder,
      ],
    );
    return { id };
  }

  /** Qty and/or variant change — re-snapshots name/price when the variant changes; `line_total_paise` is trigger-maintained. */
  async updateQtyAndVariant(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    patch: {
      qty?: number;
      menuVariantId?: string | null;
      variantNameSnapshot?: string | null;
      unitPricePaise?: number;
    },
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };
    if (patch.qty !== undefined) push('qty', patch.qty);
    if (patch.menuVariantId !== undefined) push('menu_variant_id', patch.menuVariantId);
    if (patch.variantNameSnapshot !== undefined)
      push('variant_name_snapshot', patch.variantNameSnapshot);
    if (patch.unitPricePaise !== undefined) push('unit_price_paise', patch.unitPricePaise);
    if (sets.length === 0) return;
    await tx.query(
      `UPDATE order_line SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      values,
    );
  }

  async remove(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    removedBy: string | null,
  ): Promise<void> {
    await tx.query(
      `UPDATE order_line SET status = 'REMOVED', removed_at = now(), removed_by = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, removedBy],
    );
  }
}
