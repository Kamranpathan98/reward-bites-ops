import { Injectable } from '@nestjs/common';
import type { BillAdjustmentKind, BillLineKind, BillStatus } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { toPaise, toSignedPaise } from '../../common/money/paise';
import { newId } from '../../common/security/id';

export interface BillRow {
  id: string;
  tenantId: string;
  tableSessionId: string;
  billNumber: number | null;
  status: BillStatus;
  subtotalPaise: number;
  discountPaise: number;
  roundingPaise: number;
  grandTotalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  version: number;
  customerName: string | null;
  notes: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** `created_at::text` — microsecond-exact keyset cursor value. */
  createdAtText: string;
}

interface RawBill {
  id: string;
  tenant_id: string;
  table_session_id: string;
  bill_number: string | null;
  status: BillStatus;
  subtotal_paise: string;
  discount_paise: string;
  rounding_paise: string;
  grand_total_paise: string;
  paid_paise: string;
  outstanding_paise: string;
  version: number;
  customer_name: string | null;
  notes: string | null;
  finalized_at: Date | null;
  finalized_by: string | null;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
  idempotency_key: string;
  idempotency_fingerprint: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  created_at_text: string;
}

function mapBill(row: RawBill): BillRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tableSessionId: row.table_session_id,
    billNumber: row.bill_number === null ? null : toPaise(row.bill_number, 'bill_number'),
    status: row.status,
    subtotalPaise: toPaise(row.subtotal_paise, 'subtotal_paise'),
    discountPaise: toPaise(row.discount_paise, 'discount_paise'),
    roundingPaise: toSignedPaise(row.rounding_paise, 'rounding_paise'),
    grandTotalPaise: toPaise(row.grand_total_paise, 'grand_total_paise'),
    paidPaise: toPaise(row.paid_paise, 'paid_paise'),
    outstandingPaise: toPaise(row.outstanding_paise, 'outstanding_paise'),
    version: row.version,
    customerName: row.customer_name,
    notes: row.notes,
    finalizedAt: row.finalized_at,
    finalizedBy: row.finalized_by,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason,
    idempotencyKey: row.idempotency_key,
    idempotencyFingerprint: row.idempotency_fingerprint,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdAtText: row.created_at_text,
  };
}

const BILL_COLUMNS = `id, tenant_id, table_session_id, bill_number, status, subtotal_paise,
  discount_paise, rounding_paise, grand_total_paise, paid_paise, outstanding_paise, version,
  customer_name, notes, finalized_at, finalized_by, voided_at, voided_by, void_reason,
  idempotency_key, idempotency_fingerprint, created_by, created_at, updated_at,
  created_at::text AS created_at_text`;

export interface BillLineRow {
  id: string;
  billId: string;
  orderId: string;
  orderLineId: string;
  lineKind: BillLineKind;
  addonId: string | null;
  description: string;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  sortOrder: number;
}

export interface BillLineInput {
  orderId: string;
  orderLineId: string;
  lineKind: BillLineKind;
  addonId: string | null;
  description: string;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  sortOrder: number;
}

export interface BillAdjustmentRow {
  id: string;
  billId: string;
  kind: BillAdjustmentKind;
  label: string;
  basisBp: number | null;
  amountPaise: number;
  appliedBy: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface BillingSettings {
  roundToRupee: boolean;
  maxDiscountBp: number;
  cashEnabled: boolean;
  upiEnabled: boolean;
  upiReferenceRequired: boolean;
}

export interface TotalsUpdate {
  subtotalPaise: number;
  discountPaise: number;
  roundingPaise: number;
  grandTotalPaise: number;
}

/** `bill` and its children are tenant-scoped — every method must run inside `withTenantTx`. */
@Injectable()
export class BillRepository {
  async findById(tx: TransactionContext, tenantId: string, id: string): Promise<BillRow | null> {
    const result = await tx.query<RawBill>(
      `SELECT ${BILL_COLUMNS} FROM bill WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapBill(row) : null;
  }

  /** Row-locked read: the first step of every bill mutation (lock order: session -> bill -> orders). */
  async lockById(tx: TransactionContext, tenantId: string, id: string): Promise<BillRow | null> {
    const result = await tx.query<RawBill>(
      `SELECT ${BILL_COLUMNS} FROM bill WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? mapBill(row) : null;
  }

  async findByIdempotencyKey(
    tx: TransactionContext,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<BillRow | null> {
    const result = await tx.query<RawBill>(
      `SELECT ${BILL_COLUMNS} FROM bill WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapBill(row) : null;
  }

  async list(
    tx: TransactionContext,
    tenantId: string,
    filters: {
      status?: BillStatus;
      sessionId?: string;
      from?: string;
      to?: string;
      cursor?: { createdAtText: string; id: string };
      limit: number;
    },
  ): Promise<BillRow[]> {
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let i = 2;
    if (filters.status) {
      conditions.push(`status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.sessionId) {
      conditions.push(`table_session_id = $${i++}`);
      values.push(filters.sessionId);
    }
    if (filters.from) {
      conditions.push(`created_at >= $${i++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`created_at <= $${i++}`);
      values.push(filters.to);
    }
    if (filters.cursor) {
      conditions.push(`(created_at, id) < ($${i}::timestamptz, $${i + 1}::uuid)`);
      values.push(filters.cursor.createdAtText, filters.cursor.id);
      i += 2;
    }
    values.push(filters.limit);
    const result = await tx.query<RawBill>(
      `SELECT ${BILL_COLUMNS} FROM bill
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${i}`,
      values,
    );
    return result.rows.map(mapBill);
  }

  async insertDraft(
    tx: TransactionContext,
    input: {
      tenantId: string;
      tableSessionId: string;
      totals: TotalsUpdate;
      customerName: string | null;
      idempotencyKey: string;
      idempotencyFingerprint: string;
      createdBy: string | null;
    },
  ): Promise<BillRow> {
    const id = newId();
    const result = await tx.query<RawBill>(
      `INSERT INTO bill
         (id, tenant_id, table_session_id, subtotal_paise, discount_paise, rounding_paise,
          grand_total_paise, outstanding_paise, customer_name, idempotency_key,
          idempotency_fingerprint, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)
       RETURNING ${BILL_COLUMNS}`,
      [
        id,
        input.tenantId,
        input.tableSessionId,
        input.totals.subtotalPaise,
        input.totals.discountPaise,
        input.totals.roundingPaise,
        input.totals.grandTotalPaise,
        input.customerName,
        input.idempotencyKey,
        input.idempotencyFingerprint,
        input.createdBy,
      ],
    );
    return mapBill(result.rows[0] as RawBill);
  }

  /** Recompute a DRAFT's stored totals (outstanding = grand while nothing is paid). Bumps version. */
  async updateDraftTotals(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    totals: TotalsUpdate,
  ): Promise<void> {
    await tx.query(
      `UPDATE bill
          SET subtotal_paise = $3, discount_paise = $4, rounding_paise = $5,
              grand_total_paise = $6, outstanding_paise = $6, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
      [
        tenantId,
        id,
        totals.subtotalPaise,
        totals.discountPaise,
        totals.roundingPaise,
        totals.grandTotalPaise,
      ],
    );
  }

  async markDiscarded(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(
      `UPDATE bill SET status = 'DISCARDED', version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
      [tenantId, id],
    );
  }

  /** DRAFT -> FINALIZED. `bill_number` is allocated by the caller, late in the transaction. */
  async markFinalized(
    tx: TransactionContext,
    input: {
      tenantId: string;
      id: string;
      billNumber: number;
      finalizedBy: string | null;
      totals: TotalsUpdate;
    },
  ): Promise<void> {
    await tx.query(
      `UPDATE bill
          SET status = 'FINALIZED', bill_number = $3, finalized_at = now(), finalized_by = $4,
              subtotal_paise = $5, discount_paise = $6, rounding_paise = $7,
              grand_total_paise = $8, outstanding_paise = $8, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
      [
        input.tenantId,
        input.id,
        input.billNumber,
        input.finalizedBy,
        input.totals.subtotalPaise,
        input.totals.discountPaise,
        input.totals.roundingPaise,
        input.totals.grandTotalPaise,
      ],
    );
  }

  /** FINALIZED -> VOID. Touches only status, the voided_* columns and version, never the financial snapshot. */
  async markVoided(
    tx: TransactionContext,
    input: { tenantId: string; id: string; voidedBy: string | null; reason: string },
  ): Promise<void> {
    await tx.query(
      `UPDATE bill
          SET status = 'VOID', voided_at = now(), voided_by = $3, void_reason = $4,
              version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'FINALIZED'`,
      [input.tenantId, input.id, input.voidedBy, input.reason],
    );
  }

  // ---------------------------------------------------------------- bill_order

  async insertBillOrders(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
    orderIds: string[],
  ): Promise<void> {
    for (const orderId of orderIds) {
      await tx.query(`INSERT INTO bill_order (tenant_id, bill_id, order_id) VALUES ($1, $2, $3)`, [
        tenantId,
        billId,
        orderId,
      ]);
    }
  }

  /** The orders this bill covers (historical association), ascending id. */
  async listBillOrderIds(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
  ): Promise<string[]> {
    const result = await tx.query<{ order_id: string }>(
      `SELECT order_id FROM bill_order WHERE tenant_id = $1 AND bill_id = $2 ORDER BY order_id ASC`,
      [tenantId, billId],
    );
    return result.rows.map((r) => r.order_id);
  }

  // ----------------------------------------------------------------- bill_line

  async insertBillLines(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
    lines: BillLineInput[],
  ): Promise<void> {
    for (const line of lines) {
      await tx.query(
        `INSERT INTO bill_line
           (id, tenant_id, bill_id, order_id, order_line_id, line_kind, addon_id, description,
            qty, unit_price_paise, line_total_paise, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId(),
          tenantId,
          billId,
          line.orderId,
          line.orderLineId,
          line.lineKind,
          line.addonId,
          line.description,
          line.qty,
          line.unitPricePaise,
          line.lineTotalPaise,
          line.sortOrder,
        ],
      );
    }
  }

  async deleteBillLines(tx: TransactionContext, tenantId: string, billId: string): Promise<void> {
    await tx.query(`DELETE FROM bill_line WHERE tenant_id = $1 AND bill_id = $2`, [
      tenantId,
      billId,
    ]);
  }

  async listBillLines(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
  ): Promise<BillLineRow[]> {
    const result = await tx.query<{
      id: string;
      bill_id: string;
      order_id: string;
      order_line_id: string;
      line_kind: BillLineKind;
      addon_id: string | null;
      description: string;
      qty: number;
      unit_price_paise: string;
      line_total_paise: string;
      sort_order: number;
    }>(
      `SELECT id, bill_id, order_id, order_line_id, line_kind, addon_id, description, qty,
              unit_price_paise, line_total_paise, sort_order
         FROM bill_line
        WHERE tenant_id = $1 AND bill_id = $2
        ORDER BY sort_order ASC, id ASC`,
      [tenantId, billId],
    );
    return result.rows.map((r) => ({
      id: r.id,
      billId: r.bill_id,
      orderId: r.order_id,
      orderLineId: r.order_line_id,
      lineKind: r.line_kind,
      addonId: r.addon_id,
      description: r.description,
      qty: r.qty,
      unitPricePaise: toPaise(r.unit_price_paise, 'unit_price_paise'),
      lineTotalPaise: toPaise(r.line_total_paise, 'line_total_paise'),
      sortOrder: r.sort_order,
    }));
  }

  // ------------------------------------------------------------ bill_adjustment

  async listAdjustments(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
  ): Promise<BillAdjustmentRow[]> {
    const result = await tx.query<{
      id: string;
      bill_id: string;
      kind: BillAdjustmentKind;
      label: string;
      basis_bp: number | null;
      amount_paise: string;
      applied_by: string | null;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT id, bill_id, kind, label, basis_bp, amount_paise, applied_by, reason, created_at
         FROM bill_adjustment
        WHERE tenant_id = $1 AND bill_id = $2
        ORDER BY created_at ASC, id ASC`,
      [tenantId, billId],
    );
    return result.rows.map((r) => ({
      id: r.id,
      billId: r.bill_id,
      kind: r.kind,
      label: r.label,
      basisBp: r.basis_bp,
      amountPaise: toPaise(r.amount_paise, 'amount_paise'),
      appliedBy: r.applied_by,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  /** Insert the bill's single discount, or replace it in place (DRAFT only; the DB enforces both). */
  async upsertDiscount(
    tx: TransactionContext,
    input: {
      tenantId: string;
      billId: string;
      existingId: string | null;
      kind: BillAdjustmentKind;
      label: string;
      basisBp: number | null;
      amountPaise: number;
      appliedBy: string | null;
      reason: string | null;
    },
  ): Promise<void> {
    if (input.existingId) {
      await tx.query(
        `UPDATE bill_adjustment
            SET kind = $3, label = $4, basis_bp = $5, amount_paise = $6, applied_by = $7, reason = $8
          WHERE tenant_id = $1 AND id = $2`,
        [
          input.tenantId,
          input.existingId,
          input.kind,
          input.label,
          input.basisBp,
          input.amountPaise,
          input.appliedBy,
          input.reason,
        ],
      );
      return;
    }
    await tx.query(
      `INSERT INTO bill_adjustment
         (id, tenant_id, bill_id, kind, label, basis_bp, amount_paise, applied_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        newId(),
        input.tenantId,
        input.billId,
        input.kind,
        input.label,
        input.basisBp,
        input.amountPaise,
        input.appliedBy,
        input.reason,
      ],
    );
  }

  /** Update only the derived amount (finalize re-derives a percent discount from its basis points). */
  async updateDiscountAmount(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    amountPaise: number,
  ): Promise<void> {
    await tx.query(
      `UPDATE bill_adjustment SET amount_paise = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, amountPaise],
    );
  }

  /** Removing a discount = DELETE of the DRAFT adjustment row. */
  async deleteAdjustment(tx: TransactionContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`DELETE FROM bill_adjustment WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  }

  // ------------------------------------------------------------------ settings

  /**
   * Narrow, local read of the billing-relevant `tenant_settings` (same precedent
   * as OrderRepository.getOrdersWorkflow: the module graph does not let billing
   * import the tenancy repository). There is no settings API in V1, so the
   * column defaults are the effective values (round_to_rupee = true).
   */
  async getBillingSettings(tx: TransactionContext, tenantId: string): Promise<BillingSettings> {
    const result = await tx.query<{
      round_to_rupee: boolean;
      max_discount_bp: number;
      cash_enabled: boolean;
      upi_enabled: boolean;
      upi_reference_required: boolean;
    }>(
      `SELECT round_to_rupee, max_discount_bp, cash_enabled, upi_enabled, upi_reference_required
         FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    return {
      roundToRupee: row?.round_to_rupee ?? true,
      maxDiscountBp: row?.max_discount_bp ?? 5000,
      cashEnabled: row?.cash_enabled ?? true,
      upiEnabled: row?.upi_enabled ?? false,
      upiReferenceRequired: row?.upi_reference_required ?? true,
    };
  }
}
