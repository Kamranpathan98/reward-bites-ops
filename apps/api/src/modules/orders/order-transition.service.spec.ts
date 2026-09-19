import type { TransactionContext } from '../../common/db';
import type { OrderRow } from './order.repository';
import type { OrderStatusHistoryRepository } from './order-status-history.repository';
import type { OrdersService } from './orders.service';

jest.mock('../../common/db', () => {
  const actual = jest.requireActual('../../common/db');
  return {
    ...actual,
    withTenantTx: jest.fn(
      async (_pool: unknown, _input: unknown, fn: (tx: TransactionContext) => unknown) =>
        fn(fakeTx),
    ),
  };
});

import { OrderTransitionService } from './order-transition.service';
import type { OrderRepository } from './order.repository';
import type { PermissionResolutionService } from '../../common/security/permission-resolution.service';

const fakeTx: TransactionContext = {
  tenantId: 'tenant-a',
  userId: 'actor-user-id',
  actorKind: 'staff',
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

const baseOrder: OrderRow = {
  id: 'order-1',
  tenantId: 'tenant-a',
  tableSessionId: 'session-1',
  orderNumber: '#0001',
  source: 'COUNTER',
  type: 'TAKEAWAY',
  customerName: null,
  status: 'NEW',
  version: 0,
  placedAt: new Date(),
  acceptedAt: null,
  readyAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  cancelledBy: null,
  subtotalPaise: 5000,
  lineCount: 1,
  notes: null,
  billId: null,
  idempotencyKey: 'key-1',
  idempotencyFingerprint: 'fingerprint-1',
  createdBy: 'user-1',
};

function makeService(overrides?: {
  orderRepository?: Partial<OrderRepository>;
  permissions?: Partial<PermissionResolutionService>;
}) {
  const orderRepository = {
    findById: jest.fn().mockResolvedValue(baseOrder),
    getOrdersWorkflow: jest.fn().mockResolvedValue('KITCHEN'),
    conditionalTransition: jest.fn(),
    conditionalCancel: jest.fn(),
    conditionalReopen: jest.fn(),
    lockById: jest.fn().mockResolvedValue(baseOrder),
    ...overrides?.orderRepository,
  } as unknown as OrderRepository;

  const historyRepository = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrderStatusHistoryRepository;

  const permissions = {
    getPermissionsForMembership: jest
      .fn()
      .mockResolvedValue(new Set(['orders.transition.front', 'orders.transition.kitchen'])),
    ...overrides?.permissions,
  } as unknown as PermissionResolutionService;

  const ordersService = {
    getById: jest.fn().mockResolvedValue({ id: baseOrder.id }),
  } as unknown as OrdersService;

  const service = new OrderTransitionService(
    {} as never,
    orderRepository,
    historyRepository,
    permissions,
    ordersService,
  );

  return { service, orderRepository, historyRepository, permissions, ordersService };
}

const actor = {
  userId: 'actor-1',
  tenantId: 'tenant-a',
  membershipId: 'membership-1',
  actorKind: 'staff' as const,
};

describe('OrderTransitionService.transition — state machine validation', () => {
  beforeEach(() => {
    (fakeTx.query as jest.Mock).mockClear();
  });

  it('rejects NEW -> READY as an invalid transition, touches nothing', async () => {
    const { service, orderRepository } = makeService({
      orderRepository: { findById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'NEW' }) },
    });
    await expect(
      service.transition(actor, 'order-1', { to: 'READY', expectedVersion: 0 }),
    ).rejects.toThrow('Cannot transition an order from NEW to READY');
    expect(orderRepository.conditionalTransition).not.toHaveBeenCalled();
  });

  it('rejects COMPLETED -> anything (terminal state)', async () => {
    const { service, orderRepository } = makeService({
      orderRepository: {
        findById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'COMPLETED' }),
      },
    });
    await expect(
      service.transition(actor, 'order-1', { to: 'ACCEPTED', expectedVersion: 5 }),
    ).rejects.toThrow('Cannot transition an order from COMPLETED to ACCEPTED');
    expect(orderRepository.conditionalTransition).not.toHaveBeenCalled();
  });

  it('rejects the NEW -> COMPLETED shortcut when the tenant is in KITCHEN mode', async () => {
    const { service, orderRepository } = makeService({
      orderRepository: {
        findById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'NEW' }),
        getOrdersWorkflow: jest.fn().mockResolvedValue('KITCHEN'),
      },
    });
    await expect(
      service.transition(actor, 'order-1', { to: 'COMPLETED', expectedVersion: 0 }),
    ).rejects.toThrow('kitchen mode');
    expect(orderRepository.conditionalTransition).not.toHaveBeenCalled();
  });

  it('allows the NEW -> COMPLETED shortcut when the tenant is in SIMPLE mode', async () => {
    const { service, orderRepository } = makeService({
      orderRepository: {
        findById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'NEW' }),
        getOrdersWorkflow: jest.fn().mockResolvedValue('SIMPLE'),
        conditionalTransition: jest
          .fn()
          .mockResolvedValue({ ...baseOrder, status: 'COMPLETED', version: 1 }),
      },
    });
    await service.transition(actor, 'order-1', { to: 'COMPLETED', expectedVersion: 0 });
    expect(orderRepository.conditionalTransition).toHaveBeenCalledWith(
      fakeTx,
      'tenant-a',
      'order-1',
      { fromStatus: 'NEW', toStatus: 'COMPLETED', expectedVersion: 0 },
    );
  });

  it('rejects a transition when the actor lacks the specific required permission, even though the guard allowed "any"', async () => {
    const { service, orderRepository } = makeService({
      orderRepository: {
        findById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'ACCEPTED' }),
      },
      permissions: {
        // Actor has front but not kitchen — insufficient for ACCEPTED -> PREPARING.
        getPermissionsForMembership: jest
          .fn()
          .mockResolvedValue(new Set(['orders.transition.front'])),
      },
    });
    await expect(
      service.transition(actor, 'order-1', { to: 'PREPARING', expectedVersion: 0 }),
    ).rejects.toThrow('You do not have permission to make this transition.');
    expect(orderRepository.conditionalTransition).not.toHaveBeenCalled();
  });

  it('maps a zero-row conditional UPDATE (lost race) to 409 VERSION_CONFLICT with the fresh status', async () => {
    const { service } = makeService({
      orderRepository: {
        findById: jest
          .fn()
          .mockResolvedValueOnce({ ...baseOrder, status: 'NEW', version: 0 })
          .mockResolvedValueOnce({ ...baseOrder, status: 'ACCEPTED', version: 1 }),
        conditionalTransition: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(
      service.transition(actor, 'order-1', { to: 'ACCEPTED', expectedVersion: 0 }),
    ).rejects.toThrow('This order is already ACCEPTED');
  });
});

describe('OrderTransitionService.cancel', () => {
  it('requires the order to be in a cancellable state', async () => {
    const { service } = makeService({
      orderRepository: {
        lockById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'COMPLETED' }),
        conditionalCancel: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(
      service.cancel(actor, 'order-1', { expectedVersion: 0, reason: 'x' }),
    ).rejects.toThrow('already COMPLETED and cannot be cancelled');
  });

  it('rejects cancelling an order that is already billed', async () => {
    const { service } = makeService({
      orderRepository: {
        lockById: jest.fn().mockResolvedValue({ ...baseOrder, status: 'NEW', billId: 'bill-123' }),
      },
    });
    await expect(
      service.cancel(actor, 'order-1', { expectedVersion: 0, reason: 'x' }),
    ).rejects.toMatchObject({ status: 422, response: { code: 'ORDER_ALREADY_BILLED' } });
  });
});

describe('OrderTransitionService.reopen', () => {
  it('rejects reopening an order that is already billed', async () => {
    const { service } = makeService({
      orderRepository: {
        lockById: jest
          .fn()
          .mockResolvedValue({ ...baseOrder, status: 'CANCELLED', billId: 'bill-123' }),
      },
    });
    await expect(service.reopen(actor, 'order-1', { expectedVersion: 0 })).rejects.toMatchObject({
      status: 422,
      response: { code: 'ORDER_ALREADY_BILLED' },
    });
  });
});
