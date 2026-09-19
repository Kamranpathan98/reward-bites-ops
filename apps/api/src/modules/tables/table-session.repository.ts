import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { toPaise } from '../../common/money/paise';
import { newId } from '../../common/security/id';

export interface TableSessionRow {
  id: string;
  tenantId: string;
  tableId: string | null;
  status: 'OPEN' | 'CLOSED';
  sessionToken: string;
  openedAt: Date;
  closedAt: Date | null;
  openedByUserId: string | null;
  forceClosed: boolean;
}

interface RawRow {
  id: string;
  tenant_id: string;
  table_id: string | null;
  status: 'OPEN' | 'CLOSED';
  session_token: string;
  opened_at: Date;
  closed_at: Date | null;
  opened_by_user_id: string | null;
  force_closed: boolean;
}

function mapRow(row: RawRow): TableSessionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tableId: row.table_id,
    status: row.status,
    sessionToken: row.session_token,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openedByUserId: row.opened_by_user_id,
    forceClosed: row.force_closed,
  };
}

const SELECT_COLUMNS = `id, tenant_id, table_id, status, session_token, opened_at, closed_at, opened_by_user_id, force_closed`;

/** `table_session` is tenant-scoped — every method here must run inside `withTenantTx`. */
@Injectable()
export class TableSessionRepository {
  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<TableSessionRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM table_session WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Row-locked read, used by closeSession before validating/mutating. */
  async lockById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<TableSessionRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM table_session WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * `FOR SHARE` session lock, taken by bill-draft creation. Several drafts can
   * hold it at once, but it conflicts with session close's `FOR UPDATE`: a
   * draft can never be created on a session that is being closed, and a close
   * always sees the drafts that were created before it.
   */
  async lockSharedById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<TableSessionRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM table_session WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findOpenForTable(
    tx: TransactionContext,
    tenantId: string,
    tableId: string,
  ): Promise<TableSessionRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM table_session
        WHERE tenant_id = $1 AND table_id = $2 AND status = 'OPEN'`,
      [tenantId, tableId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async listOpenForTables(
    tx: TransactionContext,
    tenantId: string,
    tableIds: string[],
  ): Promise<Map<string, TableSessionRow>> {
    if (tableIds.length === 0) return new Map();
    const result = await tx.query<RawRow>(
      `SELECT ${SELECT_COLUMNS} FROM table_session
        WHERE tenant_id = $1 AND status = 'OPEN' AND table_id = ANY($2::uuid[])`,
      [tenantId, tableIds],
    );
    const map = new Map<string, TableSessionRow>();
    for (const row of result.rows) {
      const mapped = mapRow(row);
      if (mapped.tableId) map.set(mapped.tableId, mapped);
    }
    return map;
  }

  /**
   * Opens a session for a table, or — with `tableId: null` — a takeaway
   * session with no table at all (architecture section 8: "Takeaway and
   * future delivery orders get a session with table_id = NULL"; Gate 6 is
   * the first caller of that case). Relies entirely on the partial unique
   * index `table_session_tenant_table_open_unique` (one OPEN session per
   * table) to arbitrate a race between two concurrent callers for the
   * table_id-not-null case — this method does not pre-check for an
   * existing open session itself, since that check-then-insert shape would
   * itself race under concurrency (same pattern as the idempotency-key
   * insert flow elsewhere in this codebase). The partial index is
   * `WHERE table_id IS NOT NULL`, so a `NULL` tableId is never arbitrated
   * by it — every takeaway order gets its own new session, which is the
   * architecture's own stated 1:1 shape (no takeaway "session reuse"
   * concept is described anywhere). The loser of a concurrent same-table
   * race gets a unique-violation error (Postgres error code 23505) and
   * must handle it as a normal business conflict, not a crash.
   */
  async openForTable(
    tx: TransactionContext,
    input: {
      tenantId: string;
      tableId: string | null;
      sessionToken: string;
      openedByUserId: string | null;
    },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO table_session (id, tenant_id, table_id, session_token, opened_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.tenantId, input.tableId, input.sessionToken, input.openedByUserId],
    );
    return { id };
  }

  async close(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    forceClosed: boolean,
  ): Promise<void> {
    await tx.query(
      `UPDATE table_session SET status = 'CLOSED', closed_at = now(), force_closed = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, forceClosed],
    );
  }

  // --------------------------------------------------------------------------
  // Gate 8: what a session's orders and bills mean for closing it, and for the
  // cashier floor view. These are narrow, tenant-scoped reads/writes of the
  // `orders` and `bill` tables kept local to this repository: `tables` sits
  // below `billing` in the module graph, so importing the billing repository
  // here would create a cycle (same precedent as OrderRepository.getOrdersWorkflow).
  // --------------------------------------------------------------------------

  /**
   * Blockers for a NORMAL close: non-terminal orders (NEW, ACCEPTED, PREPARING,
   * READY), DRAFT bills, and FINALIZED (unpaid) bills. PAID / VOID / DISCARDED
   * bills and COMPLETED / CANCELLED orders never block.
   */
  async countClosureBlockers(
    tx: TransactionContext,
    tenantId: string,
    sessionId: string,
  ): Promise<{ openOrders: number; draftBills: number; unpaidBills: number }> {
    const orders = await tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM orders
        WHERE tenant_id = $1 AND table_session_id = $2
          AND status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY')`,
      [tenantId, sessionId],
    );
    const bills = await tx.query<{ status: string; n: string }>(
      `SELECT status, count(*) AS n FROM bill
        WHERE tenant_id = $1 AND table_session_id = $2 AND status IN ('DRAFT', 'FINALIZED')
        GROUP BY status`,
      [tenantId, sessionId],
    );
    const byStatus = new Map(bills.rows.map((r) => [r.status, toPaise(r.n, 'bill count')]));
    return {
      openOrders: toPaise(orders.rows[0]?.n ?? '0', 'order count'),
      draftBills: byStatus.get('DRAFT') ?? 0,
      unpaidBills: byStatus.get('FINALIZED') ?? 0,
    };
  }

  /**
   * Force-close: release every DRAFT bill of the session by DISCARDing it (a
   * draft never links orders, so no order is touched). Locks the drafts in
   * ascending id order AFTER the session lock (session -> bill lock order).
   * Returns the discarded bill ids for auditing.
   */
  async discardDraftBills(
    tx: TransactionContext,
    tenantId: string,
    sessionId: string,
  ): Promise<string[]> {
    const drafts = await tx.query<{ id: string }>(
      `SELECT id FROM bill
        WHERE tenant_id = $1 AND table_session_id = $2 AND status = 'DRAFT'
        ORDER BY id ASC
        FOR UPDATE`,
      [tenantId, sessionId],
    );
    const ids = drafts.rows.map((r) => r.id);
    if (ids.length === 0) return [];
    await tx.query(
      `UPDATE bill SET status = 'DISCARDED', version = version + 1
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'DRAFT'`,
      [tenantId, ids],
    );
    return ids;
  }

  /**
   * `GET /tables/live` counts for the given OPEN sessions.
   *  - openOrderCount: the session's non-terminal orders (NEW/ACCEPTED/PREPARING/READY),
   *    including orders that are already billed but still operationally active.
   *  - unpaidBillTotalPaise: SUM(outstanding_paise) of the session's FINALIZED bills
   *    (DRAFT is not receivable; PAID/VOID/DISCARDED owe nothing).
   * SUM() comes back as a numeric string, hence the checked conversion.
   */
  async liveCountsForSessions(
    tx: TransactionContext,
    tenantId: string,
    sessionIds: string[],
  ): Promise<Map<string, { openOrderCount: number; unpaidBillTotalPaise: number }>> {
    const counts = new Map<string, { openOrderCount: number; unpaidBillTotalPaise: number }>();
    if (sessionIds.length === 0) return counts;
    const orders = await tx.query<{ table_session_id: string; n: string }>(
      `SELECT table_session_id, count(*) AS n FROM orders
        WHERE tenant_id = $1 AND table_session_id = ANY($2::uuid[])
          AND status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY')
        GROUP BY table_session_id`,
      [tenantId, sessionIds],
    );
    const bills = await tx.query<{ table_session_id: string; total: string }>(
      `SELECT table_session_id, SUM(outstanding_paise) AS total FROM bill
        WHERE tenant_id = $1 AND table_session_id = ANY($2::uuid[]) AND status = 'FINALIZED'
        GROUP BY table_session_id`,
      [tenantId, sessionIds],
    );
    for (const id of sessionIds) counts.set(id, { openOrderCount: 0, unpaidBillTotalPaise: 0 });
    for (const row of orders.rows) {
      const entry = counts.get(row.table_session_id);
      if (entry) entry.openOrderCount = toPaise(row.n, 'open order count');
    }
    for (const row of bills.rows) {
      const entry = counts.get(row.table_session_id);
      if (entry) entry.unpaidBillTotalPaise = toPaise(row.total, 'unpaid bill total');
    }
    return counts;
  }
}
