import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateOrderRequest,
  ListOrdersQuery,
  OrderDetail,
  OrderSummary,
  PatchOrderLinesRequest,
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
import { canonicalJsonFingerprint } from '../../common/security/idempotency-fingerprint';
import { generateOpaqueToken } from '../../common/security/opaque-token';
import { PermissionResolutionService } from '../../common/security/permission-resolution.service';
import { recordAuditEvent } from '../audit/audit-writer';
import { MenuSnapshotService } from '../menu/menu-snapshot.service';
import { RestaurantTableRepository } from '../tables/restaurant-table.repository';
import { TableSessionRepository } from '../tables/table-session.repository';
import { OrderLineAddonRepository } from './order-line-addon.repository';
import { OrderLineRepository, type OrderLineRow } from './order-line.repository';
import { OrderRepository, type OrderRow } from './order.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import type { ActingUser } from './orders.types';

function toSummary(order: OrderRow): OrderSummary {
  return {
    id: order.id,
    tableSessionId: order.tableSessionId,
    orderNumber: order.orderNumber,
    source: order.source,
    type: order.type,
    customerName: order.customerName,
    status: order.status,
    version: order.version,
    placedAt: order.placedAt.toISOString(),
    acceptedAt: order.acceptedAt ? order.acceptedAt.toISOString() : null,
    readyAt: order.readyAt ? order.readyAt.toISOString() : null,
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    cancelReason: order.cancelReason,
    subtotalPaise: order.subtotalPaise,
    lineCount: order.lineCount,
    notes: order.notes,
    billId: order.billId ?? null,
  };
}

function encodeCursor(order: OrderRow): string {
  return Buffer.from(
    JSON.stringify({ placedAt: order.placedAt.toISOString(), id: order.id }),
  ).toString('base64url');
}

function decodeCursor(cursor: string): { placedAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as {
      placedAt: string;
      id: string;
    };
    if (typeof parsed.placedAt !== 'string' || typeof parsed.id !== 'string')
      throw new Error('shape');
    return parsed;
  } catch {
    throw new DomainError(400, 'VALIDATION_FAILED', 'Invalid cursor.');
  }
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly orderRepository: OrderRepository,
    private readonly orderLineRepository: OrderLineRepository,
    private readonly orderLineAddonRepository: OrderLineAddonRepository,
    private readonly orderStatusHistoryRepository: OrderStatusHistoryRepository,
    private readonly tableRepository: RestaurantTableRepository,
    private readonly sessionRepository: TableSessionRepository,
    private readonly menuSnapshotService: MenuSnapshotService,
    private readonly permissions: PermissionResolutionService,
  ) {}

  async list(
    tenantId: string,
    query: ListOrdersQuery,
  ): Promise<{ orders: OrderSummary[]; nextCursor: string | null }> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const rows = await this.orderRepository.listForTenant(tx, tenantId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(cursor ? { cursor } : {}),
        limit: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeCursor(pageRows[pageRows.length - 1] as OrderRow)
          : null;
      return { orders: pageRows.map(toSummary), nextCursor };
    });
  }

  async getById(tenantId: string, id: string): Promise<OrderDetail> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const order = await this.orderRepository.findById(tx, tenantId, id);
      if (!order) throw new NotFoundException('Order not found.');
      return this.assembleDetail(tx, tenantId, order);
    });
  }

  /**
   * Idempotent creation (architecture section 12): the whole flow — resolve
   * session, price every line server-side, insert order + lines + addon
   * snapshots, record the initial NEW history row, audit — runs as one
   * speculative transaction. Never a pre-check-then-insert: if the
   * `orders_tenant_idempotency_key_unique` constraint rejects the insert
   * (a concurrent or repeated call with the same key), the whole
   * transaction rolls back — including any session it opened as a side
   * effect — and a *separate* transaction re-reads the row that actually
   * won, comparing fingerprints to decide replay vs `IDEMPOTENT_MISMATCH`.
   */
  async createOrder(
    actor: ActingUser,
    input: CreateOrderRequest,
  ): Promise<{ order: OrderDetail; replay: boolean }> {
    if (input.type === 'DINE_IN' && !input.tableId) {
      throw new DomainError(422, 'VALIDATION_FAILED', 'A table is required for a dine-in order.');
    }
    if (input.type === 'TAKEAWAY' && input.tableId) {
      throw new DomainError(422, 'VALIDATION_FAILED', 'Takeaway orders cannot reference a table.');
    }

    const { idempotencyKey, ...fingerprintBody } = input;
    const fingerprint = canonicalJsonFingerprint(fingerprintBody);

    try {
      const orderId = await withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
        async (tx) => {
          const tableSessionId = await this.resolveSession(tx, actor, input);

          const counterValue = await nextTenantCounterValue(
            tx,
            actor.tenantId,
            'order_number',
            true,
          );
          const orderNumber = `#${String(counterValue).padStart(4, '0')}`;

          const order = await this.orderRepository.create(tx, {
            tenantId: actor.tenantId,
            tableSessionId,
            orderNumber,
            source: 'COUNTER',
            type: input.type,
            customerName: input.customerName ?? null,
            notes: input.notes ?? null,
            idempotencyKey,
            idempotencyFingerprint: fingerprint,
            createdBy: actor.userId,
          });

          let sortOrder = 0;
          for (const line of input.lines) {
            await this.createPricedLine(tx, actor.tenantId, order.id, line, sortOrder++);
          }

          await this.orderStatusHistoryRepository.record(tx, {
            tenantId: actor.tenantId,
            orderId: order.id,
            fromStatus: null,
            toStatus: 'NEW',
            actorKind: actor.actorKind,
            actorId: actor.userId,
          });

          await recordAuditEvent(tx, {
            entityType: 'orders',
            entityId: order.id,
            action: 'created',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: { orderNumber, type: input.type, lineCount: input.lines.length },
          });

          return order.id;
        },
      );

      const order = await this.getById(actor.tenantId, orderId);
      return { order, replay: false };
    } catch (err) {
      if (!isUniqueViolation(err, 'orders_tenant_idempotency_key_unique')) throw err;

      return withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, actorKind: actor.actorKind },
        async (tx) => {
          const existing = await this.orderRepository.findByIdempotencyKey(
            tx,
            actor.tenantId,
            idempotencyKey,
          );
          if (!existing) throw err;
          if (existing.idempotencyFingerprint !== fingerprint) {
            throw new DomainError(
              409,
              'IDEMPOTENT_MISMATCH',
              'This idempotency key was already used for a different request.',
            );
          }
          const order = await this.assembleDetail(tx, actor.tenantId, existing);
          return { order, replay: true };
        },
      );
    }
  }

  /**
   * `PATCH /orders/:id/lines` — architecture section 8: NEW/ACCEPTED free
   * edit with `orders.update`; PREPARING/READY additionally require
   * `orders.update.in_progress` **and** a reason; COMPLETED/CANCELLED never
   * editable. The base `orders.update` permission is enforced by the
   * controller's guard; the status-conditional extra permission can only
   * be checked here, once the order's actual current status is known.
   */
  async editLines(
    actor: ActingUser,
    orderId: string,
    input: PatchOrderLinesRequest,
  ): Promise<OrderDetail> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const order = await this.orderRepository.lockById(tx, actor.tenantId, orderId);
        if (!order) throw new NotFoundException('Order not found.');

        // Billed orders are rejected BEFORE the version check: a stale client must
        // learn "billed" (422), not a generic version conflict, and the order was
        // just read under FOR UPDATE so a concurrent finalize is already visible.
        if (order.billId) {
          throw new DomainError(
            422,
            'ORDER_ALREADY_BILLED',
            'This order is already billed and its lines cannot be edited. Void its bill first.',
            { billId: order.billId },
          );
        }

        if (order.version !== input.expectedVersion) {
          throw new DomainError(
            409,
            'VERSION_CONFLICT',
            'This order was changed by someone else.',
            {
              currentStatus: order.status,
              currentVersion: order.version,
            },
          );
        }
        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
          throw new DomainError(409, 'ORDER_NOT_EDITABLE', 'This order can no longer be edited.');
        }
        if (order.status === 'PREPARING' || order.status === 'READY') {
          if (!input.reason) {
            throw new DomainError(
              422,
              'VALIDATION_FAILED',
              'A reason is required to edit an order that is already being prepared.',
            );
          }
          const granted = await this.permissions.getPermissionsForMembership(
            actor.tenantId,
            actor.membershipId,
          );
          if (!granted.has('orders.update.in_progress')) {
            throw new DomainError(
              403,
              'PERMISSION_DENIED',
              'You do not have permission to edit an order that is already being prepared.',
            );
          }
        }

        const before = await this.snapshotLinesForAudit(tx, actor.tenantId, order.id);

        for (const line of input.add ?? []) {
          await this.createPricedLine(tx, actor.tenantId, order.id, line, 10_000 + before.length);
        }
        for (const update of input.update ?? []) {
          const existingLine = await this.orderLineRepository.findById(
            tx,
            actor.tenantId,
            update.lineId,
          );
          if (
            !existingLine ||
            existingLine.orderId !== order.id ||
            existingLine.status !== 'ACTIVE'
          ) {
            throw new NotFoundException('Order line not found.');
          }
          if (update.variantId !== undefined) {
            const priced = await this.menuSnapshotService.priceLine(tx, actor.tenantId, {
              itemId: existingLine.menuItemId,
              ...(update.variantId ? { variantId: update.variantId } : {}),
              addons: [],
            });
            await this.orderLineRepository.updateQtyAndVariant(tx, actor.tenantId, update.lineId, {
              ...(update.qty !== undefined ? { qty: update.qty } : {}),
              menuVariantId: update.variantId,
              variantNameSnapshot: priced.variantNameSnapshot,
              unitPricePaise: priced.unitPricePaise,
            });
          } else if (update.qty !== undefined) {
            await this.orderLineRepository.updateQtyAndVariant(tx, actor.tenantId, update.lineId, {
              qty: update.qty,
            });
          }
        }
        for (const lineId of input.remove ?? []) {
          const existingLine = await this.orderLineRepository.findById(tx, actor.tenantId, lineId);
          if (!existingLine || existingLine.orderId !== order.id) {
            throw new NotFoundException('Order line not found.');
          }
          await this.orderLineRepository.remove(tx, actor.tenantId, lineId, actor.userId);
        }

        await this.orderRepository.bumpVersion(tx, actor.tenantId, order.id);

        const after = await this.snapshotLinesForAudit(tx, actor.tenantId, order.id);
        await recordAuditEvent(tx, {
          entityType: 'orders',
          entityId: order.id,
          action: 'edited',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { lines: before },
          after: { lines: after },
          ...(input.reason ? { reason: input.reason } : {}),
        });
      },
    );

    return this.getById(actor.tenantId, orderId);
  }

  private async resolveSession(
    tx: TransactionContext,
    actor: ActingUser,
    input: CreateOrderRequest,
  ): Promise<string> {
    if (input.type === 'TAKEAWAY') {
      const created = await this.sessionRepository.openForTable(tx, {
        tenantId: actor.tenantId,
        tableId: null,
        sessionToken: generateOpaqueToken(),
        openedByUserId: actor.userId,
      });
      return created.id;
    }

    const tableId = input.tableId as string;
    const table = await this.tableRepository.findById(tx, actor.tenantId, tableId);
    if (!table || table.deletedAt) throw new NotFoundException('Table not found.');

    const openSession = await this.sessionRepository.findOpenForTable(tx, actor.tenantId, tableId);
    if (openSession) return openSession.id;

    const created = await this.sessionRepository.openForTable(tx, {
      tenantId: actor.tenantId,
      tableId,
      sessionToken: generateOpaqueToken(),
      openedByUserId: actor.userId,
    });
    return created.id;
  }

  private async createPricedLine(
    tx: TransactionContext,
    tenantId: string,
    orderId: string,
    line: CreateOrderRequest['lines'][number],
    sortOrder: number,
  ): Promise<void> {
    const priced = await this.menuSnapshotService.priceLine(tx, tenantId, {
      itemId: line.itemId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      addons: (line.addons ?? []).map((a) => ({ addonId: a.addonId, qty: a.qty })),
    });

    const orderLine = await this.orderLineRepository.create(tx, {
      tenantId,
      orderId,
      menuItemId: line.itemId,
      menuVariantId: line.variantId ?? null,
      itemNameSnapshot: priced.itemNameSnapshot,
      variantNameSnapshot: priced.variantNameSnapshot,
      unitPricePaise: priced.unitPricePaise,
      qty: line.qty,
      notes: line.notes ?? null,
      sortOrder,
    });

    if (priced.addons.length > 0) {
      await this.orderLineAddonRepository.createMany(
        tx,
        tenantId,
        orderLine.id,
        priced.addons.map((a) => ({
          addonId: a.addonId,
          nameSnapshot: a.nameSnapshot,
          unitPricePaise: a.unitPricePaise,
          qty: a.qty,
        })),
      );
    }
  }

  private async snapshotLinesForAudit(
    tx: TransactionContext,
    tenantId: string,
    orderId: string,
  ): Promise<unknown[]> {
    const linesByOrder = await this.orderLineRepository.listForOrders(tx, tenantId, [orderId]);
    const lines = linesByOrder.get(orderId) ?? [];
    return lines.map((l) => ({
      id: l.id,
      name: l.itemNameSnapshot,
      qty: l.qty,
      unitPricePaise: l.unitPricePaise,
      status: l.status,
    }));
  }

  async assembleDetail(
    tx: TransactionContext,
    tenantId: string,
    order: OrderRow,
  ): Promise<OrderDetail> {
    const linesByOrder = await this.orderLineRepository.listForOrders(tx, tenantId, [order.id]);
    const lines = (linesByOrder.get(order.id) ?? []) as OrderLineRow[];
    const addonsByLine = await this.orderLineAddonRepository.listForLines(
      tx,
      tenantId,
      lines.map((l) => l.id),
    );
    const historyByOrder = await this.orderStatusHistoryRepository.listForOrders(tx, tenantId, [
      order.id,
    ]);
    const history = historyByOrder.get(order.id) ?? [];

    return {
      ...toSummary(order),
      lines: lines.map((l) => ({
        id: l.id,
        menuItemId: l.menuItemId,
        menuVariantId: l.menuVariantId,
        itemNameSnapshot: l.itemNameSnapshot,
        variantNameSnapshot: l.variantNameSnapshot,
        unitPricePaise: l.unitPricePaise,
        qty: l.qty,
        lineTotalPaise: l.lineTotalPaise,
        notes: l.notes,
        status: l.status,
        sortOrder: l.sortOrder,
        addons: (addonsByLine.get(l.id) ?? []).map((a) => ({
          addonId: a.addonId,
          nameSnapshot: a.nameSnapshot,
          unitPricePaise: a.unitPricePaise,
          qty: a.qty,
        })),
      })),
      history: history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorKind: h.actorKind,
        actorId: h.actorId,
        at: h.at.toISOString(),
        reason: h.reason,
      })),
    };
  }
}
