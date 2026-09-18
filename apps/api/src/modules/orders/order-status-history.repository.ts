import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@rewardbite/contracts';
import type { ActorKind, TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface OrderStatusHistoryRow {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorKind: ActorKind;
  actorId: string | null;
  at: Date;
  reason: string | null;
}

interface RawRow {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_kind: ActorKind;
  actor_id: string | null;
  at: Date;
  reason: string | null;
}

function mapRow(row: RawRow): OrderStatusHistoryRow {
  return {
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    at: row.at,
    reason: row.reason,
  };
}

/**
 * `order_status_history` is append-only (architecture section 8: "this IS
 * the audit trail for orders" — no UPDATE/DELETE grant for app_rw). Every
 * method here must run inside `withTenantTx`.
 */
@Injectable()
export class OrderStatusHistoryRepository {
  async listForOrders(
    tx: TransactionContext,
    tenantId: string,
    orderIds: string[],
  ): Promise<Map<string, OrderStatusHistoryRow[]>> {
    if (orderIds.length === 0) return new Map();
    const result = await tx.query<RawRow & { order_id: string }>(
      `SELECT order_id, from_status, to_status, actor_kind, actor_id, at, reason
         FROM order_status_history
        WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
        ORDER BY at ASC`,
      [tenantId, orderIds],
    );
    const map = new Map<string, OrderStatusHistoryRow[]>();
    for (const row of result.rows) {
      const mapped = mapRow(row);
      const list = map.get(row.order_id) ?? [];
      list.push(mapped);
      map.set(row.order_id, list);
    }
    return map;
  }

  async record(
    tx: TransactionContext,
    input: {
      tenantId: string;
      orderId: string;
      fromStatus: OrderStatus | null;
      toStatus: OrderStatus;
      actorKind: ActorKind;
      actorId: string | null;
      reason?: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO order_status_history (id, tenant_id, order_id, from_status, to_status, actor_kind, actor_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(),
        input.tenantId,
        input.orderId,
        input.fromStatus,
        input.toStatus,
        input.actorKind,
        input.actorId,
        input.reason ?? null,
      ],
    );
  }
}
