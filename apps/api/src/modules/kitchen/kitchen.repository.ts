import { Injectable } from '@nestjs/common';
import type { KitchenOrderStatus, OrderSource, OrderType } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';

export interface KitchenOrderRow {
  id: string;
  orderNumber: string;
  tableSessionId: string | null;
  tableName: string;
  customerName: string | null;
  source: OrderSource;
  type: OrderType;
  status: KitchenOrderStatus;
  version: number;
  placedAt: Date;
  acceptedAt: Date | null;
  readyAt: Date | null;
  notes: string | null;
}

export interface KitchenOrderLineRow {
  id: string;
  orderId: string;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  qty: number;
  notes: string | null;
  status: 'ACTIVE' | 'REMOVED';
  sortOrder: number;
}

export interface KitchenOrderLineAddonRow {
  orderLineId: string;
  addonId: string;
  nameSnapshot: string;
  qty: number;
}

export interface KitchenOrderEditInfo {
  orderId: string;
  reason: string | null;
}

interface RawKitchenOrderRow {
  id: string;
  order_number: string;
  table_session_id: string | null;
  table_name: string;
  customer_name: string | null;
  source: OrderSource;
  type: OrderType;
  status: KitchenOrderStatus;
  version: number;
  placed_at: Date;
  accepted_at: Date | null;
  ready_at: Date | null;
  notes: string | null;
}

interface RawKitchenLineRow {
  id: string;
  order_id: string;
  item_name_snapshot: string;
  variant_name_snapshot: string | null;
  qty: number;
  notes: string | null;
  status: 'ACTIVE' | 'REMOVED';
  sort_order: number;
}

interface RawKitchenAddonRow {
  order_line_id: string;
  addon_id: string;
  name_snapshot: string;
  qty: number;
}

interface RawEditInfoRow {
  entity_id: string;
  reason: string | null;
}

@Injectable()
export class KitchenRepository {
  async isKitchenDisplayEnabled(tx: TransactionContext, tenantId: string): Promise<boolean> {
    const result = await tx.query<{ kitchen_display_enabled: boolean }>(
      `SELECT kitchen_display_enabled FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0]?.kitchen_display_enabled ?? false;
  }

  async listActiveOrders(
    tx: TransactionContext,
    tenantId: string,
    allowedStatuses: KitchenOrderStatus[],
  ): Promise<KitchenOrderRow[]> {
    if (allowedStatuses.length === 0) return [];

    const result = await tx.query<RawKitchenOrderRow>(
      `SELECT
        o.id,
        o.order_number,
        o.table_session_id,
        o.source,
        o.type,
        o.customer_name,
        o.status,
        o.version,
        o.placed_at,
        o.accepted_at,
        o.ready_at,
        o.notes,
        COALESCE(rt.name, CASE WHEN o.type = 'TAKEAWAY' THEN 'Takeaway' ELSE 'Counter' END) AS table_name
      FROM orders o
      LEFT JOIN table_session ts ON ts.tenant_id = o.tenant_id AND ts.id = o.table_session_id
      LEFT JOIN restaurant_table rt ON rt.tenant_id = o.tenant_id AND rt.id = ts.table_id
      WHERE o.tenant_id = $1
        AND o.status = ANY($2::text[])
      ORDER BY o.placed_at ASC, o.id ASC`,
      [tenantId, allowedStatuses],
    );

    return result.rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      tableSessionId: row.table_session_id,
      tableName: row.table_name,
      customerName: row.customer_name,
      source: row.source,
      type: row.type,
      status: row.status,
      version: row.version,
      placedAt: row.placed_at,
      acceptedAt: row.accepted_at,
      readyAt: row.ready_at,
      notes: row.notes,
    }));
  }

  async listLinesForOrders(
    tx: TransactionContext,
    tenantId: string,
    orderIds: string[],
  ): Promise<Map<string, KitchenOrderLineRow[]>> {
    if (orderIds.length === 0) return new Map();

    const result = await tx.query<RawKitchenLineRow>(
      `SELECT
        id,
        order_id,
        item_name_snapshot,
        variant_name_snapshot,
        qty,
        notes,
        status,
        sort_order
      FROM order_line
      WHERE tenant_id = $1
        AND order_id = ANY($2::uuid[])
      ORDER BY sort_order ASC, id ASC`,
      [tenantId, orderIds],
    );

    const map = new Map<string, KitchenOrderLineRow[]>();
    for (const row of result.rows) {
      const line: KitchenOrderLineRow = {
        id: row.id,
        orderId: row.order_id,
        itemNameSnapshot: row.item_name_snapshot,
        variantNameSnapshot: row.variant_name_snapshot,
        qty: row.qty,
        notes: row.notes,
        status: row.status,
        sortOrder: row.sort_order,
      };
      const list = map.get(line.orderId) ?? [];
      list.push(line);
      map.set(line.orderId, list);
    }
    return map;
  }

  async listAddonsForLines(
    tx: TransactionContext,
    tenantId: string,
    lineIds: string[],
  ): Promise<Map<string, KitchenOrderLineAddonRow[]>> {
    if (lineIds.length === 0) return new Map();

    const result = await tx.query<RawKitchenAddonRow>(
      `SELECT
        order_line_id,
        addon_id,
        name_snapshot,
        qty
      FROM order_line_addon
      WHERE tenant_id = $1
        AND order_line_id = ANY($2::uuid[])`,
      [tenantId, lineIds],
    );

    const map = new Map<string, KitchenOrderLineAddonRow[]>();
    for (const row of result.rows) {
      const addon: KitchenOrderLineAddonRow = {
        orderLineId: row.order_line_id,
        addonId: row.addon_id,
        nameSnapshot: row.name_snapshot,
        qty: row.qty,
      };
      const list = map.get(addon.orderLineId) ?? [];
      list.push(addon);
      map.set(addon.orderLineId, list);
    }
    return map;
  }

  async getLatestEditInfoForOrders(
    tx: TransactionContext,
    tenantId: string,
    orderIds: string[],
  ): Promise<Map<string, string | null>> {
    if (orderIds.length === 0) return new Map();

    const result = await tx.query<RawEditInfoRow>(
      `SELECT DISTINCT ON (entity_id)
        entity_id,
        after->>'reason' AS reason
      FROM audit_event
      WHERE tenant_id = $1
        AND entity_type = 'orders'
        AND entity_id = ANY($2::uuid[])
        AND action = 'edited'
      ORDER BY entity_id, at DESC`,
      [tenantId, orderIds],
    );

    const map = new Map<string, string | null>();
    for (const row of result.rows) {
      map.set(row.entity_id, row.reason);
    }
    return map;
  }
}
