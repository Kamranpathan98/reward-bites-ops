import type { TransactionContext } from '../../common/db';

const fakeTx: TransactionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  userId: 'actor-user-id',
  actorKind: 'staff',
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

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

import type { Pool } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { KitchenRepository, type KitchenOrderRow } from './kitchen.repository';
import { KitchenService } from './kitchen.service';

describe('KitchenService', () => {
  let service: KitchenService;
  let kitchenRepository: jest.Mocked<KitchenRepository>;
  const mockPool = {} as Pool;

  beforeEach(() => {
    kitchenRepository = {
      isKitchenDisplayEnabled: jest.fn(),
      listActiveOrders: jest.fn(),
      listLinesForOrders: jest.fn(),
      listAddonsForLines: jest.fn(),
      getLatestEditInfoForOrders: jest.fn(),
    } as unknown as jest.Mocked<KitchenRepository>;

    service = new KitchenService(mockPool, kitchenRepository);
  });

  it('throws FEATURE_DISABLED when kitchen display is not enabled', async () => {
    kitchenRepository.isKitchenDisplayEnabled.mockResolvedValue(false);

    await expect(service.getOrders('00000000-0000-0000-0000-000000000001', {})).rejects.toThrow(
      new DomainError(
        403,
        'FEATURE_DISABLED',
        'Kitchen display is not enabled for this restaurant.',
      ),
    );
  });

  it('maps active kitchen orders with lines, addons, and edit tracking', async () => {
    kitchenRepository.isKitchenDisplayEnabled.mockResolvedValue(true);

    const placedAt = new Date('2026-09-19T10:00:00Z');
    const acceptedAt = new Date('2026-09-19T10:05:00Z');

    const mockOrders: KitchenOrderRow[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        orderNumber: '#0001',
        tableSessionId: '22222222-2222-2222-2222-222222222222',
        tableName: 'Table 4',
        customerName: 'Aarav',
        source: 'QR_DINE_IN',
        type: 'DINE_IN',
        status: 'ACCEPTED',
        version: 2,
        placedAt,
        acceptedAt,
        readyAt: null,
        notes: 'Less spicy please',
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        orderNumber: '#0002',
        tableSessionId: null,
        tableName: 'Takeaway',
        customerName: null,
        source: 'COUNTER',
        type: 'TAKEAWAY',
        status: 'NEW',
        version: 0,
        placedAt,
        acceptedAt: null,
        readyAt: null,
        notes: null,
      },
    ];

    kitchenRepository.listActiveOrders.mockResolvedValue(mockOrders);

    kitchenRepository.listLinesForOrders.mockResolvedValue(
      new Map([
        [
          '11111111-1111-1111-1111-111111111111',
          [
            {
              id: 'line-1',
              orderId: '11111111-1111-1111-1111-111111111111',
              itemNameSnapshot: 'Paneer Tikka',
              variantNameSnapshot: 'Full',
              qty: 2,
              notes: 'Crispy',
              status: 'ACTIVE',
              sortOrder: 0,
            },
            {
              id: 'line-2',
              orderId: '11111111-1111-1111-1111-111111111111',
              itemNameSnapshot: 'Garlic Naan',
              variantNameSnapshot: null,
              qty: 1,
              notes: null,
              status: 'REMOVED',
              sortOrder: 1,
            },
          ],
        ],
        ['33333333-3333-3333-3333-333333333333', []],
      ]),
    );

    kitchenRepository.listAddonsForLines.mockResolvedValue(
      new Map([
        [
          'line-1',
          [
            {
              orderLineId: 'line-1',
              addonId: 'addon-1',
              nameSnapshot: 'Extra Mint Chutney',
              qty: 1,
            },
          ],
        ],
      ]),
    );

    kitchenRepository.getLatestEditInfoForOrders.mockResolvedValue(
      new Map([['11111111-1111-1111-1111-111111111111', 'Guest cancelled naan']]),
    );

    const response = await service.getOrders('00000000-0000-0000-0000-000000000001', {});

    expect(response.data).toHaveLength(2);
    expect(response.meta.serverTime).toBeDefined();

    const ticket1 = response.data[0];
    expect(ticket1.orderNumber).toBe('#0001');
    expect(ticket1.tableName).toBe('Table 4');
    expect(ticket1.customerName).toBe('Aarav');
    expect(ticket1.status).toBe('ACCEPTED');
    expect(ticket1.version).toBe(2);
    expect(ticket1.isEdited).toBe(true);
    expect(ticket1.editReason).toBe('Guest cancelled naan');
    expect(ticket1.lines).toHaveLength(2);

    expect(ticket1.lines[0]).toEqual({
      id: 'line-1',
      itemName: 'Paneer Tikka',
      variantName: 'Full',
      qty: 2,
      notes: 'Crispy',
      status: 'ACTIVE',
      addons: [
        {
          addonId: 'addon-1',
          nameSnapshot: 'Extra Mint Chutney',
          qty: 1,
        },
      ],
    });

    expect(ticket1.lines[1]).toEqual({
      id: 'line-2',
      itemName: 'Garlic Naan',
      variantName: null,
      qty: 1,
      notes: null,
      status: 'REMOVED',
      addons: [],
    });

    const ticket2 = response.data[1];
    expect(ticket2.orderNumber).toBe('#0002');
    expect(ticket2.tableName).toBe('Takeaway');
    expect(ticket2.status).toBe('NEW');
    expect(ticket2.isEdited).toBe(false);
    expect(ticket2.editReason).toBeNull();
  });
});
