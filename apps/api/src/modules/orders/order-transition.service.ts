import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CancelOrderRequest,
  OrderDetail,
  OrderStatus,
  OrderTransitionTarget,
  ReopenOrderRequest,
  TransitionOrderRequest,
} from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { PermissionResolutionService } from '../../common/security/permission-resolution.service';
import { recordAuditEvent } from '../audit/audit-writer';
import { OrderRepository } from './order.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrdersService } from './orders.service';
import type { ActingUser } from './orders.types';

// Architecture section 8's mermaid state machine, verbatim — fixed in
// code, never per-tenant (the tenant setting only controls which edges the
// *UI* offers, not which edges exist). CANCELLED is reachable from every
// non-terminal state but is deliberately absent here — it only has its own
// dedicated `cancel()` method/endpoint below, never the generic transition.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderTransitionTarget[]> = {
  NEW: ['ACCEPTED', 'COMPLETED'],
  ACCEPTED: ['PREPARING', 'COMPLETED'],
  PREPARING: ['READY'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

// "NEW --> COMPLETED : no-kitchen mode" / "ACCEPTED --> COMPLETED :
// no-kitchen mode" — only reachable when tenant_settings.orders_workflow
// = 'SIMPLE'.
const SIMPLE_MODE_ONLY_SHORTCUTS = new Set<OrderStatus>(['NEW', 'ACCEPTED']);

const TRANSITION_PERMISSION: Record<
  OrderTransitionTarget,
  'orders.transition.front' | 'orders.transition.kitchen'
> = {
  ACCEPTED: 'orders.transition.front',
  PREPARING: 'orders.transition.kitchen',
  READY: 'orders.transition.kitchen',
  COMPLETED: 'orders.transition.front',
};

const CANCELLABLE_FROM: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY'];

@Injectable()
export class OrderTransitionService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly orderRepository: OrderRepository,
    private readonly orderStatusHistoryRepository: OrderStatusHistoryRepository,
    private readonly permissions: PermissionResolutionService,
    private readonly ordersService: OrdersService,
  ) {}

  async transition(
    actor: ActingUser,
    orderId: string,
    input: TransitionOrderRequest,
  ): Promise<OrderDetail> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const order = await this.orderRepository.findById(tx, actor.tenantId, orderId);
        if (!order) throw new NotFoundException('Order not found.');

        const allowedTargets = ALLOWED_TRANSITIONS[order.status];
        if (!allowedTargets.includes(input.to)) {
          throw new DomainError(
            409,
            'INVALID_TRANSITION',
            `Cannot transition an order from ${order.status} to ${input.to}.`,
            { currentStatus: order.status, currentVersion: order.version },
          );
        }

        if (input.to === 'COMPLETED' && SIMPLE_MODE_ONLY_SHORTCUTS.has(order.status)) {
          const workflow = await this.orderRepository.getOrdersWorkflow(tx, actor.tenantId);
          if (workflow !== 'SIMPLE') {
            throw new DomainError(
              409,
              'INVALID_TRANSITION',
              'This tenant uses kitchen mode — complete the order via READY first.',
              { currentStatus: order.status },
            );
          }
        }

        const requiredPermission = TRANSITION_PERMISSION[input.to];
        const granted = await this.permissions.getPermissionsForMembership(
          actor.tenantId,
          actor.membershipId,
        );
        if (!granted.has(requiredPermission)) {
          throw new DomainError(
            403,
            'PERMISSION_DENIED',
            'You do not have permission to make this transition.',
          );
        }

        const updated = await this.orderRepository.conditionalTransition(
          tx,
          actor.tenantId,
          orderId,
          {
            fromStatus: order.status,
            toStatus: input.to,
            expectedVersion: input.expectedVersion,
          },
        );
        if (!updated) {
          const fresh = await this.orderRepository.findById(tx, actor.tenantId, orderId);
          throw new DomainError(
            409,
            'VERSION_CONFLICT',
            `This order is already ${fresh?.status ?? 'in a different state'}.`,
            { currentStatus: fresh?.status ?? null, currentVersion: fresh?.version ?? null },
          );
        }

        await this.orderStatusHistoryRepository.record(tx, {
          tenantId: actor.tenantId,
          orderId,
          fromStatus: order.status,
          toStatus: input.to,
          actorKind: actor.actorKind,
          actorId: actor.userId,
          ...(input.reason ? { reason: input.reason } : {}),
        });
      },
    );

    return this.ordersService.getById(actor.tenantId, orderId);
  }

  async cancel(
    actor: ActingUser,
    orderId: string,
    input: CancelOrderRequest,
  ): Promise<OrderDetail> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const order = await this.orderRepository.lockById(tx, actor.tenantId, orderId);
        if (!order) throw new NotFoundException('Order not found.');

        if (order.billId) {
          throw new DomainError(
            422,
            'ORDER_ALREADY_BILLED',
            'This order is already billed. Void its bill before cancelling it.',
            { currentStatus: order.status, currentVersion: order.version, billId: order.billId },
          );
        }

        const updated = await this.orderRepository.conditionalCancel(tx, actor.tenantId, orderId, {
          allowedFromStatuses: CANCELLABLE_FROM,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          cancelledBy: actor.userId,
        });
        if (!updated) {
          throw new DomainError(
            409,
            order.status === 'COMPLETED' || order.status === 'CANCELLED'
              ? 'INVALID_TRANSITION'
              : 'VERSION_CONFLICT',
            `This order is already ${order.status} and cannot be cancelled.`,
            { currentStatus: order.status, currentVersion: order.version },
          );
        }

        await this.orderStatusHistoryRepository.record(tx, {
          tenantId: actor.tenantId,
          orderId,
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          reason: input.reason,
        });

        await recordAuditEvent(tx, {
          entityType: 'orders',
          entityId: orderId,
          action: 'cancelled',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          reason: input.reason,
        });
      },
    );

    return this.ordersService.getById(actor.tenantId, orderId);
  }

  /**
   * `orders.reopen`: COMPLETED & unbilled -> ACCEPTED, audited (architecture
   * section 8). "Unbilled" means `orders.bill_id IS NULL`: a billed order is
   * rejected here with 422 ORDER_ALREADY_BILLED (read under the row lock), the
   * conditional UPDATE repeats `bill_id IS NULL`, and orders_billed_guard is the
   * database backstop.
   */
  async reopen(
    actor: ActingUser,
    orderId: string,
    input: ReopenOrderRequest,
  ): Promise<OrderDetail> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const order = await this.orderRepository.lockById(tx, actor.tenantId, orderId);
        if (!order) throw new NotFoundException('Order not found.');

        if (order.billId) {
          throw new DomainError(
            422,
            'ORDER_ALREADY_BILLED',
            'This order is already billed. Void its bill before reopening it.',
            { currentStatus: order.status, currentVersion: order.version, billId: order.billId },
          );
        }

        const updated = await this.orderRepository.conditionalReopen(
          tx,
          actor.tenantId,
          orderId,
          input.expectedVersion,
        );
        if (!updated) {
          throw new DomainError(
            409,
            order.status === 'COMPLETED' ? 'VERSION_CONFLICT' : 'INVALID_TRANSITION',
            order.status === 'COMPLETED'
              ? 'This order was changed by someone else.'
              : `Only a COMPLETED order can be reopened (currently ${order.status}).`,
            { currentStatus: order.status, currentVersion: order.version },
          );
        }

        await this.orderStatusHistoryRepository.record(tx, {
          tenantId: actor.tenantId,
          orderId,
          fromStatus: 'COMPLETED',
          toStatus: 'ACCEPTED',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });

        await recordAuditEvent(tx, {
          entityType: 'orders',
          entityId: orderId,
          action: 'reopened',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
      },
    );

    return this.ordersService.getById(actor.tenantId, orderId);
  }
}
