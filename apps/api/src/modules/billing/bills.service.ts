import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApplyDiscountRequest,
  BillDetail,
  BillStatus,
  BillSummary,
  CreateBillRequest,
  DiscardBillRequest,
  FinalizeBillRequest,
  ListBillsQuery,
  VoidBillRequest,
} from '@rewardbite/contracts';
import {
  DB_POOL,
  isUniqueViolation,
  nextTenantCounterValue,
  withTenantTx,
  type Pool,
  type TransactionContext,
} from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { toPaise } from '../../common/money/paise';
import { canonicalJsonFingerprint } from '../../common/security/idempotency-fingerprint';
import { recordAuditEvent } from '../audit/audit-writer';
import { OrderLineAddonRepository } from '../orders/order-line-addon.repository';
import { OrderLineRepository } from '../orders/order-line.repository';
import { OrderRepository, type OrderRow } from '../orders/order.repository';
import { TableSessionRepository } from '../tables/table-session.repository';
import {
  BillRepository,
  type BillAdjustmentRow,
  type BillLineInput,
  type BillRow,
} from './bill.repository';
import type { ActingUser } from './billing.types';
import {
  computeBillTotals,
  computeSubtotalPaise,
  reapplyDiscount,
  resolveDiscount,
} from './paise-calculator';

const IDEMPOTENCY_CONSTRAINT = 'bill_tenant_idempotency_key_unique';

function toSummary(bill: BillRow): BillSummary {
  return {
    id: bill.id,
    tableSessionId: bill.tableSessionId,
    billNumber: bill.billNumber,
    status: bill.status,
    subtotalPaise: bill.subtotalPaise,
    discountPaise: bill.discountPaise,
    roundingPaise: bill.roundingPaise,
    grandTotalPaise: bill.grandTotalPaise,
    paidPaise: bill.paidPaise,
    outstandingPaise: bill.outstandingPaise,
    version: bill.version,
    customerName: bill.customerName,
    notes: bill.notes,
    finalizedAt: bill.finalizedAt ? bill.finalizedAt.toISOString() : null,
    finalizedBy: bill.finalizedBy,
    voidedAt: bill.voidedAt ? bill.voidedAt.toISOString() : null,
    voidedBy: bill.voidedBy,
    voidReason: bill.voidReason,
    createdBy: bill.createdBy,
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt.toISOString(),
  };
}

export { toSummary as toBillSummary };

function encodeCursor(bill: BillRow): string {
  return Buffer.from(JSON.stringify({ createdAtText: bill.createdAtText, id: bill.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { createdAtText: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as {
      createdAtText: string;
      id: string;
    };
    if (typeof parsed.createdAtText !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('shape');
    }
    return parsed;
  } catch {
    throw new DomainError(400, 'VALIDATION_FAILED', 'Invalid cursor.');
  }
}

function discountAudit(adj: BillAdjustmentRow | undefined): Record<string, unknown> | null {
  return adj
    ? {
        kind: adj.kind,
        basisBp: adj.basisBp,
        amountPaise: adj.amountPaise,
        reason: adj.reason,
      }
    : null;
}

@Injectable()
export class BillsService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly billRepository: BillRepository,
    private readonly orderRepository: OrderRepository,
    private readonly orderLineRepository: OrderLineRepository,
    private readonly orderLineAddonRepository: OrderLineAddonRepository,
    private readonly sessionRepository: TableSessionRepository,
  ) {}

  // ------------------------------------------------------------------- reads

  async list(
    tenantId: string,
    query: ListBillsQuery,
  ): Promise<{ bills: BillSummary[]; nextCursor: string | null }> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const rows = await this.billRepository.list(tx, tenantId, {
        ...(query.status ? { status: query.status as BillStatus } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(cursor ? { cursor } : {}),
        limit: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];
      return {
        bills: page.map(toSummary),
        nextCursor: hasMore && last ? encodeCursor(last) : null,
      };
    });
  }

  async getById(tenantId: string, id: string): Promise<BillDetail> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const bill = await this.billRepository.findById(tx, tenantId, id);
      if (!bill) throw new NotFoundException('Bill not found.');
      return this.assembleDetail(tx, tenantId, bill);
    });
  }

  // ------------------------------------------------------------ create draft

  /**
   * `POST /bills`. Transaction: session `FOR SHARE` -> require OPEN -> validate
   * the orders -> insert the DRAFT, its `bill_order` rows and the `bill_line`
   * snapshot -> audit. A draft does NOT link `orders.bill_id` (that happens only
   * at finalize), so several drafts may exist for one session, even over the
   * same order; creating one never changes the session's state.
   *
   * Idempotency (architecture section 14): the key is looked up INSIDE the
   * transaction before any validation, so a replay still returns the original
   * draft after its orders have since been billed; the
   * `bill_tenant_idempotency_key_unique` constraint is the last-resort net for two
   * concurrent first attempts.
   */
  async createDraft(
    actor: ActingUser,
    input: CreateBillRequest,
  ): Promise<{ bill: BillDetail; replay: boolean }> {
    const orderIds = [...input.orderIds].sort();
    const { idempotencyKey, ...body } = input;
    const fingerprint = canonicalJsonFingerprint({
      ...body,
      orderIds,
      customerName: input.customerName ?? null,
    });

    const run = (): Promise<{ bill: BillDetail; replay: boolean }> =>
      withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
        async (tx) => {
          const existing = await this.billRepository.findByIdempotencyKey(
            tx,
            actor.tenantId,
            idempotencyKey,
          );
          if (existing) return this.replayOrMismatch(tx, actor.tenantId, existing, fingerprint);

          const session = await this.sessionRepository.lockSharedById(
            tx,
            actor.tenantId,
            input.sessionId,
          );
          if (!session) throw new NotFoundException('Table session not found.');
          if (session.status !== 'OPEN') {
            throw new DomainError(409, 'SESSION_CLOSED', 'This table session is closed.');
          }

          const orders = await this.orderRepository.findByIds(tx, actor.tenantId, orderIds);
          if (orders.length !== orderIds.length) throw new NotFoundException('Order not found.');
          this.assertOrdersBillable(orders, session.id);

          const lines = await this.buildSnapshot(tx, actor.tenantId, orderIds);
          if (lines.length === 0) {
            throw new DomainError(
              422,
              'ORDER_NOT_BILLABLE',
              'The selected orders have no active items to bill.',
              { reason: 'NO_ACTIVE_LINES' },
            );
          }
          const settings = await this.billRepository.getBillingSettings(tx, actor.tenantId);
          const subtotal = computeSubtotalPaise(lines.map((l) => l.lineTotalPaise));
          const totals = computeBillTotals(subtotal, 0, settings.roundToRupee);

          const bill = await this.billRepository.insertDraft(tx, {
            tenantId: actor.tenantId,
            tableSessionId: session.id,
            totals,
            customerName: input.customerName ?? null,
            idempotencyKey,
            idempotencyFingerprint: fingerprint,
            createdBy: actor.userId,
          });
          await this.billRepository.insertBillOrders(tx, actor.tenantId, bill.id, orderIds);
          await this.billRepository.insertBillLines(tx, actor.tenantId, bill.id, lines);

          await recordAuditEvent(tx, {
            entityType: 'bill',
            entityId: bill.id,
            action: 'created',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: { orderIds, lineCount: lines.length, ...totals },
          });

          return { bill: await this.assembleDetail(tx, actor.tenantId, bill), replay: false };
        },
      );

    try {
      return await run();
    } catch (err) {
      if (!isUniqueViolation(err, IDEMPOTENCY_CONSTRAINT)) throw err;
      // A concurrent request with the same key won; the loser's transaction has
      // rolled back. Re-read what actually won in a fresh transaction.
      return withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, actorKind: actor.actorKind },
        async (tx) => {
          const winner = await this.billRepository.findByIdempotencyKey(
            tx,
            actor.tenantId,
            idempotencyKey,
          );
          if (!winner) throw err;
          return this.replayOrMismatch(tx, actor.tenantId, winner, fingerprint);
        },
      );
    }
  }

  // ---------------------------------------------------------------- discount

  /**
   * `PATCH /bills/:id/adjustments`. DRAFT only. `discount: null` removes the
   * discount (a DELETE of the DRAFT adjustment row; the history lives in
   * audit_event: `discount_removed`). A second discount replaces the first in
   * place (`discount_applied`, with the previous one in `before`).
   */
  async applyDiscount(
    actor: ActingUser,
    billId: string,
    input: ApplyDiscountRequest,
  ): Promise<BillDetail> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const bill = await this.lockDraft(tx, actor.tenantId, billId, input.expectedVersion);
        const settings = await this.billRepository.getBillingSettings(tx, actor.tenantId);
        const adjustments = await this.billRepository.listAdjustments(tx, actor.tenantId, billId);
        const current = adjustments.find((a) => a.kind.startsWith('DISCOUNT_'));

        if (input.discount === null) {
          if (!current) return this.assembleDetail(tx, actor.tenantId, bill); // nothing to remove
          await this.billRepository.deleteAdjustment(tx, actor.tenantId, current.id);
          const totals = computeBillTotals(bill.subtotalPaise, 0, settings.roundToRupee);
          await this.billRepository.updateDraftTotals(tx, actor.tenantId, bill.id, totals);
          await recordAuditEvent(tx, {
            entityType: 'bill',
            entityId: bill.id,
            action: 'discount_removed',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            before: discountAudit(current),
            after: { discountPaise: 0, grandTotalPaise: totals.grandTotalPaise },
          });
        } else {
          const resolved = resolveDiscount(
            bill.subtotalPaise,
            input.discount,
            settings.maxDiscountBp,
          );
          const totals = computeBillTotals(
            bill.subtotalPaise,
            resolved.amountPaise,
            settings.roundToRupee,
          );
          await this.billRepository.upsertDiscount(tx, {
            tenantId: actor.tenantId,
            billId: bill.id,
            existingId: current?.id ?? null,
            kind: resolved.adjustmentKind,
            label: resolved.label,
            basisBp: resolved.basisBp,
            amountPaise: resolved.amountPaise,
            appliedBy: actor.userId,
            reason: input.discount.reason ?? null,
          });
          await this.billRepository.updateDraftTotals(tx, actor.tenantId, bill.id, totals);
          await recordAuditEvent(tx, {
            entityType: 'bill',
            entityId: bill.id,
            action: 'discount_applied',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            before: discountAudit(current),
            after: {
              kind: resolved.adjustmentKind,
              basisBp: resolved.basisBp,
              discountPaise: resolved.amountPaise,
              grandTotalPaise: totals.grandTotalPaise,
            },
            ...(input.discount.reason ? { reason: input.discount.reason } : {}),
          });
        }

        const fresh = await this.billRepository.findById(tx, actor.tenantId, bill.id);
        return this.assembleDetail(tx, actor.tenantId, fresh as BillRow);
      },
    );
  }

  // ----------------------------------------------------------------- discard

  async discard(actor: ActingUser, billId: string, input: DiscardBillRequest): Promise<BillDetail> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const bill = await this.lockDraft(tx, actor.tenantId, billId, input.expectedVersion);
        await this.billRepository.markDiscarded(tx, actor.tenantId, bill.id);
        await recordAuditEvent(tx, {
          entityType: 'bill',
          entityId: bill.id,
          action: 'discarded',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
        const fresh = await this.billRepository.findById(tx, actor.tenantId, bill.id);
        return this.assembleDetail(tx, actor.tenantId, fresh as BillRow);
      },
    );
  }

  // ---------------------------------------------------------------- finalize

  /**
   * `POST /bills/:id/finalize` — the highest-stakes transaction in the system.
   *
   *  1. lock the bill FOR UPDATE, 2. require DRAFT + expectedVersion,
   *  3. read the member order ids,
   *  4. lock ALL covered orders FOR UPDATE in ascending id order (its own
   *     statement), 5. revalidate them (not CANCELLED, unbilled, same session),
   *  6. ONLY NOW read the active order lines / add-ons, 7. rebuild the snapshot,
   *  8. recompute subtotal -> discount -> rounding -> grand total,
   *  9. compare expectedGrandTotalPaise, require grand_total > 0,
   * 10. replace the bill_line snapshot, 11. allocate bill_number (late),
   * 12. link every order (orders.bill_id, version + 1), 13. flip the bill to
   *     FINALIZED, 14. audit.
   *
   * Why the order locks precede the line reads: READ COMMITTED gives every
   * statement a fresh snapshot, so lines read after the lock was GRANTED include
   * every edit that committed while we waited for it. Reading them earlier (or in
   * the same statement as the lock) could miss such an edit.
   */
  async finalize(
    actor: ActingUser,
    billId: string,
    input: FinalizeBillRequest,
  ): Promise<BillDetail> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const bill = await this.lockDraft(tx, actor.tenantId, billId, input.expectedVersion);

        const memberIds = await this.billRepository.listBillOrderIds(tx, actor.tenantId, bill.id);
        const locked = await this.orderRepository.lockManyAscending(tx, actor.tenantId, memberIds);
        if (locked.length !== memberIds.length) throw new NotFoundException('Order not found.');
        this.assertOrdersBillable(locked, bill.tableSessionId);

        const lines = await this.buildSnapshot(tx, actor.tenantId, memberIds);
        const settings = await this.billRepository.getBillingSettings(tx, actor.tenantId);
        const subtotal = computeSubtotalPaise(lines.map((l) => l.lineTotalPaise));

        const adjustments = await this.billRepository.listAdjustments(tx, actor.tenantId, bill.id);
        const current = adjustments.find((a) => a.kind.startsWith('DISCOUNT_'));
        const discount = current
          ? reapplyDiscount(
              subtotal,
              { kind: current.kind, basisBp: current.basisBp, amountPaise: current.amountPaise },
              settings.maxDiscountBp,
            )
          : null;
        const totals = computeBillTotals(
          subtotal,
          discount?.amountPaise ?? 0,
          settings.roundToRupee,
        );

        if (totals.grandTotalPaise !== input.expectedGrandTotalPaise) {
          throw new DomainError(
            409,
            'BILL_TOTALS_CHANGED',
            'The bill total changed since you last viewed it. Review the bill and try again.',
            { currentGrandTotalPaise: totals.grandTotalPaise },
          );
        }
        if (lines.length === 0 || totals.grandTotalPaise <= 0) {
          throw new DomainError(
            422,
            'BILL_TOTAL_NOT_POSITIVE',
            'A bill must have a total greater than zero to be finalized.',
            { grandTotalPaise: totals.grandTotalPaise },
          );
        }

        await this.billRepository.deleteBillLines(tx, actor.tenantId, bill.id);
        await this.billRepository.insertBillLines(tx, actor.tenantId, bill.id, lines);
        if (current && discount && discount.amountPaise !== current.amountPaise) {
          await this.billRepository.updateDiscountAmount(
            tx,
            actor.tenantId,
            current.id,
            discount.amountPaise,
          );
        }

        // Allocated as late as practical: the tenant_counter row lock is held to
        // commit and serializes every finalize of this tenant.
        const billNumber = await nextTenantCounterValue(tx, actor.tenantId, 'bill_number', false);

        const linked = await this.orderRepository.linkToBill(
          tx,
          actor.tenantId,
          memberIds,
          bill.id,
        );
        if (linked !== memberIds.length) {
          throw new DomainError(422, 'ORDER_ALREADY_BILLED', 'An order is already billed.');
        }
        await this.billRepository.markFinalized(tx, {
          tenantId: actor.tenantId,
          id: bill.id,
          billNumber,
          finalizedBy: actor.userId,
          totals,
        });

        await recordAuditEvent(tx, {
          entityType: 'bill',
          entityId: bill.id,
          action: 'finalized',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: { billNumber, orderIds: memberIds, ...totals },
        });

        const fresh = await this.billRepository.findById(tx, actor.tenantId, bill.id);
        return this.assembleDetail(tx, actor.tenantId, fresh as BillRow);
      },
    );
  }

  // -------------------------------------------------------------------- void

  /**
   * `POST /bills/:id/void`: FINALIZED only, reason required, refused when any
   * money was paid. Clears `orders.bill_id` (and bumps their version) but NEVER
   * deletes `bill_order` history and never touches the financial snapshot.
   */
  async void(actor: ActingUser, billId: string, input: VoidBillRequest): Promise<BillDetail> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const bill = await this.billRepository.lockById(tx, actor.tenantId, billId);
        if (!bill) throw new NotFoundException('Bill not found.');
        this.assertVersion(bill, input.expectedVersion);
        if (bill.status !== 'FINALIZED') {
          throw new DomainError(
            409,
            'BILL_NOT_VOIDABLE',
            `Only a finalized bill can be voided (this bill is ${bill.status}).`,
            { currentStatus: bill.status },
          );
        }
        if (bill.paidPaise > 0) {
          throw new DomainError(
            409,
            'BILL_HAS_PAYMENTS',
            'A bill with recorded payments cannot be voided.',
            { paidPaise: bill.paidPaise },
          );
        }

        const memberIds = await this.billRepository.listBillOrderIds(tx, actor.tenantId, bill.id);
        await this.orderRepository.lockManyAscending(tx, actor.tenantId, memberIds);
        await this.orderRepository.unlinkFromBill(tx, actor.tenantId, bill.id);
        await this.billRepository.markVoided(tx, {
          tenantId: actor.tenantId,
          id: bill.id,
          voidedBy: actor.userId,
          reason: input.reason,
        });

        await recordAuditEvent(tx, {
          entityType: 'bill',
          entityId: bill.id,
          action: 'voided',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { billNumber: bill.billNumber, grandTotalPaise: bill.grandTotalPaise },
          reason: input.reason,
        });

        const fresh = await this.billRepository.findById(tx, actor.tenantId, bill.id);
        return this.assembleDetail(tx, actor.tenantId, fresh as BillRow);
      },
    );
  }

  // ----------------------------------------------------------------- helpers

  private assertVersion(bill: BillRow, expectedVersion: number): void {
    if (bill.version !== expectedVersion) {
      throw new DomainError(409, 'VERSION_CONFLICT', 'This bill was changed by someone else.', {
        currentStatus: bill.status,
        currentVersion: bill.version,
      });
    }
  }

  /** Lock the bill and require the expected version AND status DRAFT (version is checked first: a retry after success is a version conflict). */
  private async lockDraft(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
    expectedVersion: number,
  ): Promise<BillRow> {
    const bill = await this.billRepository.lockById(tx, tenantId, billId);
    if (!bill) throw new NotFoundException('Bill not found.');
    this.assertVersion(bill, expectedVersion);
    if (bill.status !== 'DRAFT') {
      throw new DomainError(
        409,
        'BILL_NOT_DRAFT',
        `Only a draft bill can be changed (this bill is ${bill.status}).`,
        { currentStatus: bill.status },
      );
    }
    return bill;
  }

  private assertOrdersBillable(orders: OrderRow[], sessionId: string): void {
    for (const order of orders) {
      if (order.tableSessionId !== sessionId) {
        throw new DomainError(
          422,
          'ORDER_NOT_BILLABLE',
          `Order ${order.orderNumber} belongs to a different table session.`,
          { orderId: order.id, reason: 'DIFFERENT_SESSION' },
        );
      }
      if (order.status === 'CANCELLED') {
        throw new DomainError(
          422,
          'ORDER_NOT_BILLABLE',
          `Order ${order.orderNumber} is cancelled and cannot be billed.`,
          { orderId: order.id, reason: 'CANCELLED' },
        );
      }
      if (order.billId !== null) {
        throw new DomainError(
          422,
          'ORDER_ALREADY_BILLED',
          `Order ${order.orderNumber} is already billed.`,
          { orderId: order.id, billId: order.billId },
        );
      }
    }
  }

  private async replayOrMismatch(
    tx: TransactionContext,
    tenantId: string,
    existing: BillRow,
    fingerprint: string,
  ): Promise<{ bill: BillDetail; replay: boolean }> {
    if (existing.idempotencyFingerprint !== fingerprint) {
      throw new DomainError(
        409,
        'IDEMPOTENT_MISMATCH',
        'This idempotency key was already used for a different request.',
      );
    }
    return { bill: await this.assembleDetail(tx, tenantId, existing), replay: true };
  }

  /**
   * Snapshot of the ACTIVE lines of the given orders (ascending order id). Every
   * order line becomes one ITEM row and each of its add-ons its own ADDON row, so
   * each row satisfies line_total = qty * unit_price and the rows of one order line
   * sum to the order line's own total (add-on qty is NOT multiplied by the line
   * qty — verified against order_line.line_total_paise; a mismatch is a bug and
   * fails the request rather than producing a wrong bill).
   */
  private async buildSnapshot(
    tx: TransactionContext,
    tenantId: string,
    orderIds: string[],
  ): Promise<BillLineInput[]> {
    const linesByOrder = await this.orderLineRepository.listForOrders(tx, tenantId, orderIds);
    const active = orderIds.flatMap((orderId) =>
      (linesByOrder.get(orderId) ?? []).filter((l) => l.status === 'ACTIVE'),
    );
    const addonsByLine = await this.orderLineAddonRepository.listForLines(
      tx,
      tenantId,
      active.map((l) => l.id),
    );

    const out: BillLineInput[] = [];
    let sortOrder = 0;
    for (const line of active) {
      const itemTotal = BigInt(line.qty) * BigInt(line.unitPricePaise);
      let expected = itemTotal;
      out.push({
        orderId: line.orderId,
        orderLineId: line.id,
        lineKind: 'ITEM',
        addonId: null,
        description: line.variantNameSnapshot
          ? `${line.itemNameSnapshot} (${line.variantNameSnapshot})`
          : line.itemNameSnapshot,
        qty: line.qty,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: toPaise(itemTotal, 'line total'),
        sortOrder: sortOrder++,
      });
      for (const addon of addonsByLine.get(line.id) ?? []) {
        const addonTotal = BigInt(addon.qty) * BigInt(addon.unitPricePaise);
        expected += addonTotal;
        out.push({
          orderId: line.orderId,
          orderLineId: line.id,
          lineKind: 'ADDON',
          addonId: addon.addonId,
          description: `+ ${addon.nameSnapshot}`,
          qty: addon.qty,
          unitPricePaise: addon.unitPricePaise,
          lineTotalPaise: toPaise(addonTotal, 'add-on total'),
          sortOrder: sortOrder++,
        });
      }
      if (expected !== BigInt(line.lineTotalPaise)) {
        throw new Error(
          `Bill snapshot for order line ${line.id} (${expected}) does not match order_line.line_total_paise (${line.lineTotalPaise})`,
        );
      }
    }
    return out;
  }

  private async assembleDetail(
    tx: TransactionContext,
    tenantId: string,
    bill: BillRow,
  ): Promise<BillDetail> {
    const [orderIds, lines, adjustments] = await Promise.all([
      this.billRepository.listBillOrderIds(tx, tenantId, bill.id),
      this.billRepository.listBillLines(tx, tenantId, bill.id),
      this.billRepository.listAdjustments(tx, tenantId, bill.id),
    ]);
    return {
      ...toSummary(bill),
      orderIds,
      lines: lines.map((l) => ({
        id: l.id,
        orderId: l.orderId,
        orderLineId: l.orderLineId,
        lineKind: l.lineKind,
        addonId: l.addonId,
        description: l.description,
        qty: l.qty,
        unitPricePaise: l.unitPricePaise,
        lineTotalPaise: l.lineTotalPaise,
        sortOrder: l.sortOrder,
      })),
      adjustments: adjustments
        .filter((a) => a.kind === 'DISCOUNT_PERCENT' || a.kind === 'DISCOUNT_FIXED')
        .map((a) => ({
          id: a.id,
          kind: a.kind as 'DISCOUNT_PERCENT' | 'DISCOUNT_FIXED',
          label: a.label,
          basisBp: a.basisBp,
          amountPaise: a.amountPaise,
          reason: a.reason,
          appliedBy: a.appliedBy,
          createdAt: a.createdAt.toISOString(),
        })),
    };
  }
}
