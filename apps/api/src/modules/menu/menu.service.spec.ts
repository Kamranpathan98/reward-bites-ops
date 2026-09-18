import type { TransactionContext } from '../../common/db';
import type { MenuAddonRepository } from './menu-addon.repository';
import type { MenuCategoryRepository } from './menu-category.repository';
import type { MenuItemAddonRepository } from './menu-item-addon.repository';
import type { MenuItemRepository } from './menu-item.repository';
import type { MenuVariantRepository } from './menu-variant.repository';

// Same convention as users.service.spec.ts: mock withTenantTx to invoke the
// callback with a fake TransactionContext, proving MenuService's own logic
// (branch selection, argument shape) without a database. The DB-level proof
// lives in test/db/gate5-menu-catalog.integration.spec.ts.
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

import { MenuService } from './menu.service';

const fakeTx: TransactionContext = {
  tenantId: 'tenant-a',
  userId: 'actor-user-id',
  actorKind: 'staff',
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

function makeService(overrides?: {
  categoryRepository?: Partial<MenuCategoryRepository>;
  itemRepository?: Partial<MenuItemRepository>;
  variantRepository?: Partial<MenuVariantRepository>;
  addonRepository?: Partial<MenuAddonRepository>;
  itemAddonRepository?: Partial<MenuItemAddonRepository>;
}) {
  const categoryRepository = {
    findById: jest.fn(),
    findActiveByName: jest.fn(),
    hasActiveItems: jest.fn(),
    reorder: jest.fn().mockResolvedValue(undefined),
    ...overrides?.categoryRepository,
  } as unknown as MenuCategoryRepository;

  const itemRepository = {
    findById: jest.fn(),
    findActiveByCategoryAndName: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides?.itemRepository,
  } as unknown as MenuItemRepository;

  const variantRepository = {
    findById: jest.fn(),
    countActiveForItem: jest.fn(),
    softDelete: jest.fn().mockResolvedValue(undefined),
    ...overrides?.variantRepository,
  } as unknown as MenuVariantRepository;

  const addonRepository = {
    listByIds: jest.fn(),
    ...overrides?.addonRepository,
  } as unknown as MenuAddonRepository;

  const itemAddonRepository = {
    replaceForItem: jest.fn().mockResolvedValue(undefined),
    ...overrides?.itemAddonRepository,
  } as unknown as MenuItemAddonRepository;

  const service = new MenuService(
    {} as never, // DB_POOL — never touched, since withTenantTx is mocked
    categoryRepository,
    itemRepository,
    variantRepository,
    addonRepository,
    itemAddonRepository,
  );

  return {
    service,
    categoryRepository,
    itemRepository,
    variantRepository,
    addonRepository,
    itemAddonRepository,
  };
}

const actor = { userId: 'owner-1', tenantId: 'tenant-a', actorKind: 'staff' as const };

describe('MenuService.patchItem — price-change audit action', () => {
  beforeEach(() => {
    (fakeTx.query as jest.Mock).mockClear();
  });

  it('records action "price_changed" when basePricePaise actually changes', async () => {
    const { service } = makeService({
      itemRepository: {
        findById: jest.fn().mockResolvedValue({
          id: 'item-1',
          tenantId: 'tenant-a',
          categoryId: 'cat-1',
          name: 'Item',
          basePricePaise: 10000,
          deletedAt: null,
        }),
      },
    });

    await service.patchItem(actor, 'item-1', { basePricePaise: 12000 });

    const insertCall = (fakeTx.query as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO audit_event'),
    );
    expect(insertCall).toBeDefined();
    // action is the 5th bound parameter in recordAuditEvent's INSERT
    expect(insertCall[1][4]).toBe('price_changed');
  });

  it('records action "updated" (not "price_changed") when the price is unchanged', async () => {
    const { service } = makeService({
      itemRepository: {
        findById: jest.fn().mockResolvedValue({
          id: 'item-1',
          tenantId: 'tenant-a',
          categoryId: 'cat-1',
          name: 'Item',
          basePricePaise: 10000,
          deletedAt: null,
        }),
      },
    });

    await service.patchItem(actor, 'item-1', { name: 'Renamed Item' });

    const insertCall = (fakeTx.query as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO audit_event'),
    );
    expect(insertCall[1][4]).toBe('updated');
  });

  it('rejects patching a nonexistent item and touches nothing', async () => {
    const { service, itemRepository } = makeService({
      itemRepository: { findById: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.patchItem(actor, 'ghost', { name: 'x' })).rejects.toThrow(
      'Menu item not found.',
    );
    expect(itemRepository.update).not.toHaveBeenCalled();
  });
});

describe('MenuService.deleteVariant — last-variant-with-no-base-price guard', () => {
  beforeEach(() => {
    (fakeTx.query as jest.Mock).mockClear();
  });

  it('rejects deleting the last variant when the item has no base price', async () => {
    const { service, variantRepository } = makeService({
      variantRepository: {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'v1', tenantId: 'tenant-a', itemId: 'item-1', deletedAt: null }),
        countActiveForItem: jest.fn().mockResolvedValue(1),
      },
      itemRepository: {
        findById: jest.fn().mockResolvedValue({ id: 'item-1', basePricePaise: null }),
      },
    });

    await expect(service.deleteVariant(actor, 'v1')).rejects.toThrow(
      'Cannot delete the last variant of an item with no base price',
    );
    expect(variantRepository.softDelete).not.toHaveBeenCalled();
  });

  it('allows deleting a variant when the item has a base price', async () => {
    const { service, variantRepository } = makeService({
      variantRepository: {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'v1', tenantId: 'tenant-a', itemId: 'item-1', deletedAt: null }),
        countActiveForItem: jest.fn().mockResolvedValue(1),
      },
      itemRepository: {
        findById: jest.fn().mockResolvedValue({ id: 'item-1', basePricePaise: 10000 }),
      },
    });

    await service.deleteVariant(actor, 'v1');
    expect(variantRepository.softDelete).toHaveBeenCalledWith(fakeTx, 'tenant-a', 'v1');
  });

  it('allows deleting a variant when it is not the last one, even with no base price', async () => {
    const { service, variantRepository } = makeService({
      variantRepository: {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'v1', tenantId: 'tenant-a', itemId: 'item-1', deletedAt: null }),
        countActiveForItem: jest.fn().mockResolvedValue(2),
      },
      itemRepository: {
        findById: jest.fn().mockResolvedValue({ id: 'item-1', basePricePaise: null }),
      },
    });

    await service.deleteVariant(actor, 'v1');
    expect(variantRepository.softDelete).toHaveBeenCalledWith(fakeTx, 'tenant-a', 'v1');
  });
});

describe('MenuService.createItem — addon existence validation', () => {
  beforeEach(() => {
    (fakeTx.query as jest.Mock).mockClear();
  });

  it('rejects creating an item that references a nonexistent addon, and creates nothing', async () => {
    const { service, itemRepository, addonRepository } = makeService({
      categoryRepository: {
        findById: jest.fn().mockResolvedValue({ id: 'cat-1', deletedAt: null }),
        findActiveByName: jest.fn(),
      },
      itemRepository: {
        findActiveByCategoryAndName: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      addonRepository: { listByIds: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      service.createItem(actor, {
        categoryId: 'cat-1',
        name: 'Item',
        basePricePaise: 100,
        addons: [{ addonId: 'ghost-addon', maxQty: 1 }],
      }),
    ).rejects.toThrow('One or more add-ons were not found.');

    expect(itemRepository.create).not.toHaveBeenCalled();
    expect(addonRepository.listByIds).toHaveBeenCalledWith(fakeTx, 'tenant-a', ['ghost-addon']);
  });
});
