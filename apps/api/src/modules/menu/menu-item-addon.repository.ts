import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';

export interface MenuItemAddonRow {
  itemId: string;
  addonId: string;
  maxQty: number;
}

/**
 * `menu_item_addon` (PK `tenant_id, item_id, addon_id`) — the many-to-many
 * assignment of reusable addons to an item, including the per-item
 * `max_qty`. Managed as a field on the item itself (see menu.ts's
 * `itemAddonAssignmentSchema` comment) — no independent REST resource.
 * Every method here must run inside `withTenantTx`.
 */
@Injectable()
export class MenuItemAddonRepository {
  async listForItems(
    tx: TransactionContext,
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, MenuItemAddonRow[]>> {
    if (itemIds.length === 0) return new Map();
    const result = await tx.query<{ item_id: string; addon_id: string; max_qty: number }>(
      `SELECT item_id, addon_id, max_qty FROM menu_item_addon
        WHERE tenant_id = $1 AND item_id = ANY($2::uuid[])`,
      [tenantId, itemIds],
    );
    const map = new Map<string, MenuItemAddonRow[]>();
    for (const row of result.rows) {
      const list = map.get(row.item_id) ?? [];
      list.push({ itemId: row.item_id, addonId: row.addon_id, maxQty: row.max_qty });
      map.set(row.item_id, list);
    }
    return map;
  }

  /** Full replace: deletes every existing assignment for the item, then inserts the given set. */
  async replaceForItem(
    tx: TransactionContext,
    tenantId: string,
    itemId: string,
    assignments: { addonId: string; maxQty: number }[],
  ): Promise<void> {
    await tx.query(`DELETE FROM menu_item_addon WHERE tenant_id = $1 AND item_id = $2`, [
      tenantId,
      itemId,
    ]);
    for (const a of assignments) {
      await tx.query(
        `INSERT INTO menu_item_addon (tenant_id, item_id, addon_id, max_qty) VALUES ($1, $2, $3, $4)`,
        [tenantId, itemId, a.addonId, a.maxQty],
      );
    }
  }
}
