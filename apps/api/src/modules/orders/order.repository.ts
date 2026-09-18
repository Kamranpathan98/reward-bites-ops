import { Injectable } from '@nestjs/common';
import type { OrderSource, OrderStatus, OrderType } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface OrderRow {
  id: string;
  tenantId: string;
  tableSessionId: string;
  orderNumber: string;
  source: OrderSource;
  type: OrderType;
  customerName: string | null;
  status: OrderStatus;
  version: number;
  placedAt: Date;
  acceptedAt: Date | null;
  readyAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  subtotalPaise: number;
  lineCount: number;
  notes: string | null;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  createdBy: string | null;
}

interface RawRow {
  id: string;
  tenant_id: string;
  table_session_id: string;
  order_number: string;
  source: OrderSource;
  type: OrderType;
  customer_name: string | null;
  status: OrderStatus;
  version: number;
  placed_at: Date;
  accepted_at: Date | null;
  ready_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  subtotal_paise: string;
  line_count: number;
  notes: string | null;
  idempotency_key: string;
  idempotency_fingerprint: string;
  created_by: string | null;
}

function mapRow(row: RawRow): OrderRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tableSessionId: row.table_session_id,
    orderNumber: row.order_number,
    source: row.source,
    type: row.type,
    customerName: row.customer_name,
    status: row.status,
    version: row.version,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    readyAt: row.ready_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    cancelledBy: row.cancelled_by,
    subtotalPaise: Number(row.subtotal_paise),
    lineCount: row.line_count,
    notes: row.notes,
    idempotencyKey: row.idempotency_key,
    idempotencyFingerprint: row.idempotency_fingerprint,
    createdBy: row.created_by,
  };
}

const SELECT_COLUMNS = `id, tenant_id, table_session_id, order_number, source, type, customer_name,
  status, version, placed_at, accepted_at, ready_at, completed_at, cancelled_at, cancel_reason,
  cancelled_by, subtotal_paise, line_count, notes, idempotency_key, idempotency_fingerprint, created_by`;

// `status -> timestamp column` — architecture section 8's exact column
// list has no `preparing_at`, so PREPARING has no timestamp side effect.
const TRANSITION_TIMESTAMP_COLUMN: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'accepted_at',
  READY: 'ready_at',
  COMPLETED: 'completed_at',
};

/** `orders` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class OrderRepository {
  async findById(tx: TransactionContext, tenantId: string, id: string): Promise<OrderRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM orders WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Row-locked read, used before applying an edit or transition. */
  async lockById(tx: TransactionContext, tenantId: string, id: string): Promise<OrderRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByIdempotencyKey(
    tx: TransactionContext,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<OrderRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM orders WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: {
      tenantId: string;
      tableSessionId: string;
      orderNumber: string;
      source: OrderSource;
      type: OrderType;
      customerName: string | null;
      notes: string | null;
      idempotencyKey: string;
      idempotencyFingerprint: string;
      createdBy: string | null;
    },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO orders
         (id, tenant_id, table_session_id, order_number, source, type, customer_name, notes,
          idempotency_key, idempotency_fingerprint, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        input.tenantId,
        input.tableSessionId,
        input.orderNumber,
        input.source,
        input.type,
        input.customerName,
        input.notes,
        input.idempotencyKey,
        input.idempotencyFingerprint,
        input.createdBy,
      ],
    );
    return { id };
  }

  /**
   * "UPDATE orders SET status = $new, version = version + 1, ... WHERE id =
   * $id AND tenant_id = ctx AND status = $expectedFrom AND version =
   * $expectedVersion RETURNING *" (architecture section 8, verbatim). Zero
   * rows updated -> the caller re-reads and returns 409, never trusts a
   * client-supplied status directly.
   */
  async conditionalTransition(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    input: { fromStatus: OrderStatus; toStatus: OrderStatus; expectedVersion: number },
  ): Promise<OrderRow | null> {
    const timestampColumn = TRANSITION_TIMESTAMP_COLUMN[input.toStatus];
    const timestampSet = timestampColumn ? `, ${timestampColumn} = now()` : '';
    const result = await tx.query<RawRow>(
      `UPDATE orders
          SET status = $5, version = version + 1${timestampSet}
        WHERE tenant_id = $1 AND id = $2 AND status = $3 AND version = $4
      RETURNING ${SELECT_COLUMNS}`,
      [tenantId, id, input.fromStatus, input.expectedVersion, input.toStatus],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Cancellation is allowed from any of several non-terminal statuses, unlike a single-`from` transition. */
  async conditionalCancel(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    input: {
      allowedFromStatuses: OrderStatus[];
      expectedVersion: number;
      reason: string;
      cancelledBy: string | null;
    },
  ): Promise<OrderRow | null> {
    const result = await tx.query<RawRow>(
      `UPDATE orders
          SET status = 'CANCELLED', version = version + 1, cancelled_at = now(),
              cancel_reason = $5, cancelled_by = $6
        WHERE tenant_id = $1 AND id = $2 AND status = ANY($3::text[]) AND version = $4
      RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        id,
        input.allowedFromStatuses,
        input.expectedVersion,
        input.reason,
        input.cancelledBy,
      ],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** `orders.reopen`: COMPLETED & unbilled -> ACCEPTED (architecture section 8/11). */
  async conditionalReopen(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    expectedVersion: number,
  ): Promise<OrderRow | null> {
    const result = await tx.query<RawRow>(
      `UPDATE orders
          SET status = 'ACCEPTED', version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'COMPLETED' AND version = $3
      RETURNING ${SELECT_COLUMNS}`,
      [tenantId, id, expectedVersion],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Bumps `version` only — used when a lines edit doesn't otherwise change `orders` columns directly (triggers handle subtotal/line_count). */
  async bumpVersion(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE orders SET version = version + 1 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
  }

  /**
   * `tenant_settings.orders_workflow` gates whether the NEW/ACCEPTED ->
   * COMPLETED "no-kitchen mode" shortcut transitions are allowed
   * (architecture section 8's state machine, verbatim). A tiny, narrowly-
   * scoped read kept local to this repository rather than importing the
   * `tenancy` module's own repository — the module dependency graph
   * (blueprint section 4) names `tables` and `menu` as what `orders` may
   * import, not `tenancy` directly.
   */
  async getOrdersWorkflow(tx: TransactionContext, tenantId: string): Promise<'SIMPLE' | 'KITCHEN'> {
    const result = await tx.query<{ orders_workflow: 'SIMPLE' | 'KITCHEN' }>(
      `SELECT orders_workflow FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0]?.orders_workflow ?? 'SIMPLE';
  }

  async listForTenant(
    tx: TransactionContext,
    tenantId: string,
    filters: {
      status?: OrderStatus[];
      type?: OrderType;
      source?: OrderSource;
      sessionId?: string;
      from?: string;
      to?: string;
      q?: string;
      cursor?: { placedAt: string; id: string };
      limit: number;
    },
  ): Promise<OrderRow[]> {
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters.status && filters.status.length > 0) {
      conditions.push(`status = ANY($${paramIndex++}::text[])`);
      values.push(filters.status);
    }
    if (filters.type) {
      conditions.push(`type = $${paramIndex++}`);
      values.push(filters.type);
    }
    if (filters.source) {
      conditions.push(`source = $${paramIndex++}`);
      values.push(filters.source);
    }
    if (filters.sessionId) {
      conditions.push(`table_session_id = $${paramIndex++}`);
      values.push(filters.sessionId);
    }
    if (filters.from) {
      conditions.push(`placed_at >= $${paramIndex++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`placed_at <= $${paramIndex++}`);
      values.push(filters.to);
    }
    if (filters.q) {
      conditions.push(`(customer_name ILIKE $${paramIndex} OR order_number ILIKE $${paramIndex})`);
      values.push(`%${filters.q}%`);
      paramIndex++;
    }
    if (filters.cursor) {
      // Keyset pagination on (placed_at DESC, id DESC) — deterministic even
      // when several orders share the same placed_at instant.
      conditions.push(`(placed_at, id) < ($${paramIndex}, $${paramIndex + 1})`);
      values.push(filters.cursor.placedAt, filters.cursor.id);
      paramIndex += 2;
    }

    values.push(filters.limit);
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM orders
        WHERE ${conditions.join(' AND ')}
        ORDER BY placed_at DESC, id DESC
        LIMIT $${paramIndex}`,
      values,
    );
    return result.rows.map(mapRow);
  }
}
