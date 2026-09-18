import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CreateAddonRequest,
  CreateCategoryRequest,
  CreateItemRequest,
  CreateVariantRequest,
  PatchAddonRequest,
  PatchCategoryRequest,
  PatchItemRequest,
  PatchVariantRequest,
  ReorderRequest,
} from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool, type TransactionContext } from '../../common/db';
import { recordAuditEvent } from '../audit/audit-writer';
import { MenuAddonRepository } from './menu-addon.repository';
import { MenuCategoryRepository } from './menu-category.repository';
import { MenuItemAddonRepository } from './menu-item-addon.repository';
import { MenuItemRepository } from './menu-item.repository';
import { MenuVariantRepository } from './menu-variant.repository';
import type { ActingUser } from './menu.types';

@Injectable()
export class MenuService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly categoryRepository: MenuCategoryRepository,
    private readonly itemRepository: MenuItemRepository,
    private readonly variantRepository: MenuVariantRepository,
    private readonly addonRepository: MenuAddonRepository,
    private readonly itemAddonRepository: MenuItemAddonRepository,
  ) {}

  // ---- categories ---------------------------------------------------

  async createCategory(actor: ActingUser, input: CreateCategoryRequest): Promise<{ id: string }> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.categoryRepository.findActiveByName(
          tx,
          actor.tenantId,
          input.name,
        );
        if (existing) throw new ConflictException('A category with this name already exists.');

        const category = await this.categoryRepository.create(tx, {
          tenantId: actor.tenantId,
          name: input.name,
          sortOrder: input.sortOrder ?? 0,
        });

        await recordAuditEvent(tx, {
          entityType: 'menu_category',
          entityId: category.id,
          action: 'created',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: { name: input.name },
        });

        return category;
      },
    );
  }

  async patchCategory(actor: ActingUser, id: string, input: PatchCategoryRequest): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const category = await this.categoryRepository.findById(tx, actor.tenantId, id);
        if (!category || category.deletedAt) throw new NotFoundException('Category not found.');

        if (input.name !== undefined && input.name !== category.name) {
          const existing = await this.categoryRepository.findActiveByName(
            tx,
            actor.tenantId,
            input.name,
          );
          if (existing) throw new ConflictException('A category with this name already exists.');
        }

        await this.categoryRepository.update(tx, actor.tenantId, id, input);

        await recordAuditEvent(tx, {
          entityType: 'menu_category',
          entityId: id,
          action: 'updated',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: {
            name: category.name,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
          },
          after: input,
        });
      },
    );
  }

  /**
   * Blocked while the category still has non-deleted items — narrowest
   * interpretation consistent with Gate 4's "soft-delete blocked while an
   * OPEN session exists" precedent; the architecture doesn't state this
   * explicitly for menu_category.
   */
  async deleteCategory(actor: ActingUser, id: string): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const category = await this.categoryRepository.findById(tx, actor.tenantId, id);
        if (!category || category.deletedAt) throw new NotFoundException('Category not found.');

        const hasItems = await this.categoryRepository.hasActiveItems(tx, actor.tenantId, id);
        if (hasItems) {
          throw new ConflictException('This category still has menu items and cannot be deleted.');
        }

        await this.categoryRepository.softDelete(tx, actor.tenantId, id);

        await recordAuditEvent(tx, {
          entityType: 'menu_category',
          entityId: id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
      },
    );
  }

  // ---- items ----------------------------------------------------------

  async createItem(actor: ActingUser, input: CreateItemRequest): Promise<{ id: string }> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const category = await this.categoryRepository.findById(
          tx,
          actor.tenantId,
          input.categoryId,
        );
        if (!category || category.deletedAt) throw new NotFoundException('Category not found.');

        const existing = await this.itemRepository.findActiveByCategoryAndName(
          tx,
          actor.tenantId,
          input.categoryId,
          input.name,
        );
        if (existing)
          throw new ConflictException('An item with this name already exists in this category.');

        if (input.addons && input.addons.length > 0) {
          await this.assertAddonsExist(
            tx,
            actor.tenantId,
            input.addons.map((a) => a.addonId),
          );
        }

        const item = await this.itemRepository.create(tx, {
          tenantId: actor.tenantId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description ?? null,
          basePricePaise: input.basePricePaise ?? null,
          sortOrder: input.sortOrder ?? 0,
          vegFlag: input.vegFlag ?? null,
        });

        if (input.addons && input.addons.length > 0) {
          await this.itemAddonRepository.replaceForItem(tx, actor.tenantId, item.id, input.addons);
        }

        await recordAuditEvent(tx, {
          entityType: 'menu_item',
          entityId: item.id,
          action: 'created',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: {
            name: input.name,
            categoryId: input.categoryId,
            basePricePaise: input.basePricePaise ?? null,
          },
        });

        return item;
      },
    );
  }

  async patchItem(actor: ActingUser, id: string, input: PatchItemRequest): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const item = await this.itemRepository.findById(tx, actor.tenantId, id);
        if (!item || item.deletedAt) throw new NotFoundException('Menu item not found.');

        if (input.categoryId !== undefined && input.categoryId !== item.categoryId) {
          const category = await this.categoryRepository.findById(
            tx,
            actor.tenantId,
            input.categoryId,
          );
          if (!category || category.deletedAt) throw new NotFoundException('Category not found.');
        }

        const targetCategoryId = input.categoryId ?? item.categoryId;
        if (input.name !== undefined && input.name !== item.name) {
          const existing = await this.itemRepository.findActiveByCategoryAndName(
            tx,
            actor.tenantId,
            targetCategoryId,
            input.name,
          );
          if (existing)
            throw new ConflictException('An item with this name already exists in this category.');
        }

        if (input.addons && input.addons.length > 0) {
          await this.assertAddonsExist(
            tx,
            actor.tenantId,
            input.addons.map((a) => a.addonId),
          );
        }

        const priceChanged =
          input.basePricePaise !== undefined && input.basePricePaise !== item.basePricePaise;

        await this.itemRepository.update(tx, actor.tenantId, id, input);

        if (input.addons !== undefined) {
          await this.itemAddonRepository.replaceForItem(tx, actor.tenantId, id, input.addons);
        }

        await recordAuditEvent(tx, {
          entityType: 'menu_item',
          entityId: id,
          action: priceChanged ? 'price_changed' : 'updated',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: {
            name: item.name,
            basePricePaise: item.basePricePaise,
            categoryId: item.categoryId,
          },
          after: input,
        });
      },
    );
  }

  async updateItemAvailability(actor: ActingUser, id: string, isAvailable: boolean): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const item = await this.itemRepository.findById(tx, actor.tenantId, id);
        if (!item || item.deletedAt) throw new NotFoundException('Menu item not found.');

        // Architecture section 10: last-write-wins, no version check — a
        // plain UPDATE is the whole mechanism, deliberately.
        await this.itemRepository.updateAvailability(tx, actor.tenantId, id, isAvailable);

        await recordAuditEvent(tx, {
          entityType: 'menu_item',
          entityId: id,
          action: 'availability_changed',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { isAvailable: item.isAvailable },
          after: { isAvailable },
        });
      },
    );
  }

  /** Cascades to the item's variants (compositional ownership) — not to menu_item_addon links. */
  async deleteItem(actor: ActingUser, id: string): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const item = await this.itemRepository.findById(tx, actor.tenantId, id);
        if (!item || item.deletedAt) throw new NotFoundException('Menu item not found.');

        await this.variantRepository.softDeleteAllForItem(tx, actor.tenantId, id);
        await this.itemRepository.softDelete(tx, actor.tenantId, id);

        await recordAuditEvent(tx, {
          entityType: 'menu_item',
          entityId: id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
      },
    );
  }

  // ---- variants ---------------------------------------------------------

  async createVariant(actor: ActingUser, input: CreateVariantRequest): Promise<{ id: string }> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const item = await this.itemRepository.findById(tx, actor.tenantId, input.itemId);
        if (!item || item.deletedAt) throw new NotFoundException('Menu item not found.');

        const existing = await this.variantRepository.findActiveByItemAndName(
          tx,
          actor.tenantId,
          input.itemId,
          input.name,
        );
        if (existing)
          throw new ConflictException('A variant with this name already exists for this item.');

        const variant = await this.variantRepository.create(tx, {
          tenantId: actor.tenantId,
          itemId: input.itemId,
          name: input.name,
          pricePaise: input.pricePaise,
          sortOrder: input.sortOrder ?? 0,
        });

        await recordAuditEvent(tx, {
          entityType: 'menu_variant',
          entityId: variant.id,
          action: 'created',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: { itemId: input.itemId, name: input.name, pricePaise: input.pricePaise },
        });

        return variant;
      },
    );
  }

  async patchVariant(actor: ActingUser, id: string, input: PatchVariantRequest): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const variant = await this.variantRepository.findById(tx, actor.tenantId, id);
        if (!variant || variant.deletedAt) throw new NotFoundException('Variant not found.');

        if (input.name !== undefined && input.name !== variant.name) {
          const existing = await this.variantRepository.findActiveByItemAndName(
            tx,
            actor.tenantId,
            variant.itemId,
            input.name,
          );
          if (existing)
            throw new ConflictException('A variant with this name already exists for this item.');
        }

        const priceChanged =
          input.pricePaise !== undefined && input.pricePaise !== variant.pricePaise;

        await this.variantRepository.update(tx, actor.tenantId, id, input);

        await recordAuditEvent(tx, {
          entityType: 'menu_variant',
          entityId: id,
          action: priceChanged ? 'price_changed' : 'updated',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { name: variant.name, pricePaise: variant.pricePaise },
          after: input,
        });
      },
    );
  }

  async updateVariantAvailability(
    actor: ActingUser,
    id: string,
    isAvailable: boolean,
  ): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const variant = await this.variantRepository.findById(tx, actor.tenantId, id);
        if (!variant || variant.deletedAt) throw new NotFoundException('Variant not found.');

        await this.variantRepository.updateAvailability(tx, actor.tenantId, id, isAvailable);

        await recordAuditEvent(tx, {
          entityType: 'menu_variant',
          entityId: id,
          action: 'availability_changed',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { isAvailable: variant.isAvailable },
          after: { isAvailable },
        });
      },
    );
  }

  /**
   * Rejects deleting the last remaining variant of an item whose
   * `basePricePaise` is null — the one point where the architecture's
   * "base_price_paise IS NOT NULL OR EXISTS variant" invariant (stated as
   * "enforced in service") could actually be silently violated. See
   * menu.service.spec.ts for the narrower alternatives considered.
   */
  async deleteVariant(actor: ActingUser, id: string): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const variant = await this.variantRepository.findById(tx, actor.tenantId, id);
        if (!variant || variant.deletedAt) throw new NotFoundException('Variant not found.');

        const item = await this.itemRepository.findById(tx, actor.tenantId, variant.itemId);
        if (item && item.basePricePaise === null) {
          const activeCount = await this.variantRepository.countActiveForItem(
            tx,
            actor.tenantId,
            variant.itemId,
          );
          if (activeCount <= 1) {
            throw new UnprocessableEntityException(
              'Cannot delete the last variant of an item with no base price — set a base price first.',
            );
          }
        }

        await this.variantRepository.softDelete(tx, actor.tenantId, id);

        await recordAuditEvent(tx, {
          entityType: 'menu_variant',
          entityId: id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
      },
    );
  }

  // ---- addons -------------------------------------------------------

  async createAddon(actor: ActingUser, input: CreateAddonRequest): Promise<{ id: string }> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const addon = await this.addonRepository.create(tx, {
          tenantId: actor.tenantId,
          name: input.name,
          pricePaise: input.pricePaise,
        });

        await recordAuditEvent(tx, {
          entityType: 'menu_addon',
          entityId: addon.id,
          action: 'created',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: { name: input.name, pricePaise: input.pricePaise },
        });

        return addon;
      },
    );
  }

  async patchAddon(actor: ActingUser, id: string, input: PatchAddonRequest): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const addon = await this.addonRepository.findById(tx, actor.tenantId, id);
        if (!addon || addon.deletedAt) throw new NotFoundException('Add-on not found.');

        const priceChanged =
          input.pricePaise !== undefined && input.pricePaise !== addon.pricePaise;

        await this.addonRepository.update(tx, actor.tenantId, id, input);

        await recordAuditEvent(tx, {
          entityType: 'menu_addon',
          entityId: id,
          action: priceChanged ? 'price_changed' : 'updated',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { name: addon.name, pricePaise: addon.pricePaise },
          after: input,
        });
      },
    );
  }

  async deleteAddon(actor: ActingUser, id: string): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const addon = await this.addonRepository.findById(tx, actor.tenantId, id);
        if (!addon || addon.deletedAt) throw new NotFoundException('Add-on not found.');

        await this.addonRepository.softDelete(tx, actor.tenantId, id);

        await recordAuditEvent(tx, {
          entityType: 'menu_addon',
          entityId: id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
      },
    );
  }

  // ---- reorder ----------------------------------------------------------

  async reorder(actor: ActingUser, input: ReorderRequest): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        if ('categoryIds' in input) {
          await this.categoryRepository.reorder(tx, actor.tenantId, input.categoryIds);
          await recordAuditEvent(tx, {
            entityType: 'menu_category',
            action: 'reordered',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: { categoryIds: input.categoryIds },
          });
        } else {
          const category = await this.categoryRepository.findById(
            tx,
            actor.tenantId,
            input.categoryId,
          );
          if (!category || category.deletedAt) throw new NotFoundException('Category not found.');
          await this.itemRepository.reorderWithinCategory(
            tx,
            actor.tenantId,
            input.categoryId,
            input.itemIds,
          );
          await recordAuditEvent(tx, {
            entityType: 'menu_item',
            action: 'reordered',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: { categoryId: input.categoryId, itemIds: input.itemIds },
          });
        }
      },
    );
  }

  private async assertAddonsExist(
    tx: TransactionContext,
    tenantId: string,
    addonIds: string[],
  ): Promise<void> {
    const unique = [...new Set(addonIds)];
    const found = await this.addonRepository.listByIds(tx, tenantId, unique);
    if (found.length !== unique.length) {
      throw new NotFoundException('One or more add-ons were not found.');
    }
  }
}
