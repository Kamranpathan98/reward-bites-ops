import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';

export interface OrderLineAddonRow {
  orderLineId: string;
  addonId: string;
  nameSnapshot: string;
  unitPricePaise: number;
  qty: number;
}

interface RawRow {
  order_line_id: string;
  addon_id: string;
  name_snapshot: string;
  unit_price_paise: string;
  qty: number;
}

function mapRow(row: RawRow): OrderLineAddonRow {
  return {
    orderLineId: row.order_line_id,
    addonId: row.addon_id,
    nameSnapshot: row.name_snapshot,
    unitPricePaise: Number(row.unit_price_paise),
    qty: row.qty,
  };
}

/** `order_line_addon` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class OrderLineAddonRepository {
  async listForLines(
    tx: TransactionContext,
    tenantId: string,
    orderLineIds: string[],
  ): Promise<Map<string, OrderLineAddonRow[]>> {
    if (orderLineIds.length === 0) return new Map();
    const result = await tx.query<RawRow>(
      `SELECT order_line_id, addon_id, name_snapshot, unit_price_paise, qty
         FROM order_line_addon
        WHERE tenant_id = $1 AND order_line_id = ANY($2::uuid[])`,
      [tenantId, orderLineIds],
    );
    const map = new Map<string, OrderLineAddonRow[]>();
    for (const row of result.rows) {
      const mapped = mapRow(row);
      const list = map.get(mapped.orderLineId) ?? [];
      list.push(mapped);
      map.set(mapped.orderLineId, list);
    }
    return map;
  }

  async createMany(
    tx: TransactionContext,
    tenantId: string,
    orderLineId: string,
    addons: readonly {
      addonId: string;
      nameSnapshot: string;
      unitPricePaise: number;
      qty: number;
    }[],
  ): Promise<void> {
    for (const addon of addons) {
      await tx.query(
        `INSERT INTO order_line_addon (tenant_id, order_line_id, addon_id, name_snapshot, unit_price_paise, qty)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, orderLineId, addon.addonId, addon.nameSnapshot, addon.unitPricePaise, addon.qty],
      );
    }
  }

  async deleteForLine(
    tx: TransactionContext,
    tenantId: string,
    orderLineId: string,
  ): Promise<void> {
    await tx.query(`DELETE FROM order_line_addon WHERE tenant_id = $1 AND order_line_id = $2`, [
      tenantId,
      orderLineId,
    ]);
  }
}
