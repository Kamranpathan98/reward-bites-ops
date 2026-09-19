import { Inject, Injectable } from '@nestjs/common';
import type {
  KitchenOrderStatus,
  KitchenOrdersQuery,
  KitchenOrdersResponse,
  KitchenOrderTicketView,
} from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { KitchenRepository } from './kitchen.repository';

const KITCHEN_ACTIVE_STATUSES: readonly KitchenOrderStatus[] = [
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY',
];

@Injectable()
export class KitchenService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly kitchenRepository: KitchenRepository,
  ) {}

  async getOrders(tenantId: string, query: KitchenOrdersQuery): Promise<KitchenOrdersResponse> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const isEnabled = await this.kitchenRepository.isKitchenDisplayEnabled(tx, tenantId);
      if (!isEnabled) {
        throw new DomainError(
          403,
          'FEATURE_DISABLED',
          'Kitchen display is not enabled for this restaurant.',
        );
      }

      const allowedStatuses: KitchenOrderStatus[] = query.status
        ? query.status.filter((s) => KITCHEN_ACTIVE_STATUSES.includes(s))
        : [...KITCHEN_ACTIVE_STATUSES];

      const orders = await this.kitchenRepository.listActiveOrders(tx, tenantId, allowedStatuses);
      const orderIds = orders.map((o) => o.id);

      const linesByOrderId = await this.kitchenRepository.listLinesForOrders(
        tx,
        tenantId,
        orderIds,
      );

      const allLineIds: string[] = [];
      for (const lines of linesByOrderId.values()) {
        for (const line of lines) {
          allLineIds.push(line.id);
        }
      }

      const addonsByLineId = await this.kitchenRepository.listAddonsForLines(
        tx,
        tenantId,
        allLineIds,
      );
      const editReasonByOrderId = await this.kitchenRepository.getLatestEditInfoForOrders(
        tx,
        tenantId,
        orderIds,
      );

      const tickets: KitchenOrderTicketView[] = orders.map((order) => {
        const orderLines = linesByOrderId.get(order.id) ?? [];
        const hasRemovedLines = orderLines.some((l) => l.status === 'REMOVED');
        const hasEditAudit = editReasonByOrderId.has(order.id);
        const isEdited = hasRemovedLines || hasEditAudit;
        const editReason = editReasonByOrderId.get(order.id) ?? null;

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          tableName: order.tableName,
          customerName: order.customerName,
          source: order.source,
          type: order.type,
          status: order.status,
          version: order.version,
          placedAt: order.placedAt.toISOString(),
          acceptedAt: order.acceptedAt ? order.acceptedAt.toISOString() : null,
          readyAt: order.readyAt ? order.readyAt.toISOString() : null,
          notes: order.notes,
          isEdited,
          editReason,
          lines: orderLines.map((line) => {
            const addons = addonsByLineId.get(line.id) ?? [];
            return {
              id: line.id,
              itemName: line.itemNameSnapshot,
              variantName: line.variantNameSnapshot,
              qty: line.qty,
              notes: line.notes,
              status: line.status,
              addons: addons.map((a) => ({
                addonId: a.addonId,
                nameSnapshot: a.nameSnapshot,
                qty: a.qty,
              })),
            };
          }),
        };
      });

      return {
        data: tickets,
        meta: {
          serverTime: new Date().toISOString(),
        },
      };
    });
  }
}
