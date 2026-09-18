import { Inject, Injectable } from '@nestjs/common';
import type { MenuAddon, MenuCategory, MenuItem, MenuVariant } from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool, type TransactionContext } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { MenuAddonRepository } from './menu-addon.repository';
import { MenuCategoryRepository } from './menu-category.repository';
import { MenuItemAddonRepository } from './menu-item-addon.repository';
import { MenuItemRepository, type MenuItemRow } from './menu-item.repository';
import { MenuVariantRepository, type MenuVariantRow } from './menu-variant.repository';

export interface PricedLineAddon {
  readonly addonId: string;
  readonly nameSnapshot: string;
  readonly unitPricePaise: number;
  readonly qty: number;
}

export interface PricedLine {
  readonly itemNameSnapshot: string;
  readonly variantNameSnapshot: string | null;
  readonly unitPricePaise: number;
  readonly addons: readonly PricedLineAddon[];
}

function unavailable(message: string): never {
  // Architecture section 10 / task instruction §18: "returns 422
  // ITEM_UNAVAILABLE naming the item." One code for every reason a line
  // can't be priced right now (item/variant/addon gone, unavailable, or an
  // invalid item<->addon pairing) — the message is what names the specific
  // thing.
  throw new DomainError(422, 'ITEM_UNAVAILABLE', message);
}

function toVariant(row: MenuVariantRow): MenuVariant {
  return {
    id: row.id,
    name: row.name,
    pricePaise: row.pricePaise,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
  };
}

/**
 * Assembles the authenticated `GET /menu` tree (architecture section 11:
 * "full tree incl. inactive" — this is the staff editor view, not the
 * customer-facing filtered one).
 *
 * Also the home for the tree-assembly logic the architecture describes for
 * the *public* menu endpoint (section 10: "one query... categories[] ->
 * items[] -> variants[], addons[]... ETag derived from max(updated_at)") —
 * built here as an internal capability (`buildActiveTree` + `computeETag`)
 * so Gate 11's `public` module has real logic to call, not a stub, without
 * this gate exposing any `/p/*` HTTP route or touching `app_public` grants
 * (explicitly out of scope — see docs/IMPLEMENTATION_STATUS.md).
 */
@Injectable()
export class MenuSnapshotService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly categoryRepository: MenuCategoryRepository,
    private readonly itemRepository: MenuItemRepository,
    private readonly variantRepository: MenuVariantRepository,
    private readonly addonRepository: MenuAddonRepository,
    private readonly itemAddonRepository: MenuItemAddonRepository,
  ) {}

  /** Full tree, every category/item regardless of is_active/is_available — the staff editor view. */
  async getFullTree(
    tenantId: string,
  ): Promise<{ categories: MenuCategory[]; addons: MenuAddon[] }> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, (tx) =>
      this.assemble(tx, tenantId, { activeOnly: false }),
    );
  }

  /**
   * Active + available only — the shape Gate 11's public endpoint will
   * serve. Not reachable via any Gate 5 HTTP route.
   */
  async buildActiveTree(
    tenantId: string,
  ): Promise<{ categories: MenuCategory[]; addons: MenuAddon[] }> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, (tx) =>
      this.assemble(tx, tenantId, { activeOnly: true }),
    );
  }

  private async assemble(
    tx: TransactionContext,
    tenantId: string,
    opts: { activeOnly: boolean },
  ): Promise<{ categories: MenuCategory[]; addons: MenuAddon[] }> {
    const [categoryRows, itemRows, addonRows] = await Promise.all([
      this.categoryRepository.listForTenant(tx, tenantId),
      this.itemRepository.listForTenant(tx, tenantId),
      this.addonRepository.listForTenant(tx, tenantId),
    ]);

    const visibleItems = opts.activeOnly
      ? itemRows.filter((i) => i.isActive && i.isAvailable)
      : itemRows;
    const itemIds = visibleItems.map((i) => i.id);

    const [variantsByItem, itemAddonsByItem] = await Promise.all([
      this.variantRepository.listActiveForItems(tx, tenantId, itemIds),
      this.itemAddonRepository.listForItems(tx, tenantId, itemIds),
    ]);
    const addonById = new Map(addonRows.map((a) => [a.id, a]));

    const itemsByCategory = new Map<string, MenuItemRow[]>();
    for (const item of visibleItems) {
      const list = itemsByCategory.get(item.categoryId) ?? [];
      list.push(item);
      itemsByCategory.set(item.categoryId, list);
    }

    const visibleCategories = opts.activeOnly
      ? categoryRows.filter((c) => c.isActive)
      : categoryRows;

    const categories: MenuCategory[] = visibleCategories.map((category) => ({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      items: (itemsByCategory.get(category.id) ?? []).map((item): MenuItem => {
        const variants = (variantsByItem.get(item.id) ?? [])
          .filter((v) => !opts.activeOnly || v.isAvailable)
          .map(toVariant);
        const addonLinks = itemAddonsByItem.get(item.id) ?? [];
        return {
          id: item.id,
          categoryId: item.categoryId,
          name: item.name,
          description: item.description,
          imageKey: item.imageKey,
          basePricePaise: item.basePricePaise,
          isAvailable: item.isAvailable,
          isActive: item.isActive,
          sortOrder: item.sortOrder,
          vegFlag: item.vegFlag,
          variants,
          addons: addonLinks
            .map((link) => {
              const addon = addonById.get(link.addonId);
              if (!addon) return null;
              if (opts.activeOnly && (!addon.isAvailable || addon.deletedAt)) return null;
              return {
                addonId: addon.id,
                name: addon.name,
                pricePaise: addon.pricePaise,
                isAvailable: addon.isAvailable,
                maxQty: link.maxQty,
              };
            })
            .filter((a): a is NonNullable<typeof a> => a !== null),
        };
      }),
    }));

    const addons: MenuAddon[] = addonRows
      .filter((a) => !opts.activeOnly || a.isAvailable)
      .map((a) => ({
        id: a.id,
        name: a.name,
        pricePaise: a.pricePaise,
        isAvailable: a.isAvailable,
      }));

    return { categories, addons };
  }

  /**
   * `max(updated_at)` across the four tables (architecture section 10,
   * verbatim) — an internal capability for Gate 11's public endpoint, not
   * exposed here.
   */
  async computeETag(tenantId: string): Promise<string> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const result = await tx.query<{ max_updated: Date | null }>(
        `SELECT greatest(
           (SELECT max(updated_at) FROM menu_category WHERE tenant_id = $1),
           (SELECT max(updated_at) FROM menu_item WHERE tenant_id = $1),
           (SELECT max(updated_at) FROM menu_variant WHERE tenant_id = $1),
           (SELECT max(updated_at) FROM menu_addon WHERE tenant_id = $1)
         ) AS max_updated`,
        [tenantId],
      );
      const maxUpdated = result.rows[0]?.max_updated;
      return maxUpdated ? String(new Date(maxUpdated).getTime()) : '0';
    });
  }

  /**
   * "MenuSnapshotService.priceLine(itemId, variantId, addonIds) is the only
   * place prices are read for order creation; it re-checks availability and
   * returns 422 ITEM_UNAVAILABLE naming the item" (architecture section 10,
   * verbatim). Runs inside the CALLER's transaction (order creation/edit),
   * never opens its own — the resulting snapshot is written in the same
   * transaction that inserts the order line.
   *
   * Only `is_available`/`deleted_at` block ordering here, not `is_active`:
   * architecture ties `is_active` specifically to "hidden from [the
   * customer] menu" (section 10), a Gate 11 concern, and this is the
   * staff-facing counter (Gate 6) — the narrowest reading is that staff can
   * still ring up an item that's merely hidden from the public/QR menu.
   * Documented as a judgment call.
   */
  async priceLine(
    tx: TransactionContext,
    tenantId: string,
    input: {
      itemId: string;
      variantId?: string;
      addons: readonly { addonId: string; qty: number }[];
    },
  ): Promise<PricedLine> {
    const item = await this.itemRepository.findById(tx, tenantId, input.itemId);
    if (!item || item.deletedAt) unavailable('This item is no longer on the menu.');
    if (!item.isAvailable) unavailable(`${item.name} is currently unavailable.`);

    let unitPricePaise: number;
    let variantNameSnapshot: string | null = null;

    if (input.variantId) {
      const variant = await this.variantRepository.findById(tx, tenantId, input.variantId);
      if (!variant || variant.deletedAt || variant.itemId !== item.id) {
        unavailable(`The selected variant of ${item.name} is no longer available.`);
      }
      if (!variant.isAvailable) {
        unavailable(`${item.name} (${variant.name}) is currently unavailable.`);
      }
      unitPricePaise = variant.pricePaise;
      variantNameSnapshot = variant.name;
    } else {
      if (item.basePricePaise === null) {
        unavailable(`${item.name} requires selecting a variant.`);
      }
      unitPricePaise = item.basePricePaise;
    }

    const addons: PricedLineAddon[] = [];
    if (input.addons.length > 0) {
      const assignedAddons = await this.itemAddonRepository.listForItems(tx, tenantId, [item.id]);
      const assignmentByAddonId = new Map(
        (assignedAddons.get(item.id) ?? []).map((a) => [a.addonId, a]),
      );

      for (const selection of input.addons) {
        const assignment = assignmentByAddonId.get(selection.addonId);
        if (!assignment) unavailable(`That add-on is not offered with ${item.name}.`);
        if (selection.qty > assignment.maxQty) {
          unavailable(`At most ${assignment.maxQty} of that add-on can be added to ${item.name}.`);
        }

        const addon = await this.addonRepository.findById(tx, tenantId, selection.addonId);
        if (!addon || addon.deletedAt) unavailable('That add-on is no longer available.');
        if (!addon.isAvailable) unavailable(`${addon.name} is currently unavailable.`);

        addons.push({
          addonId: addon.id,
          nameSnapshot: addon.name,
          unitPricePaise: addon.pricePaise,
          qty: selection.qty,
        });
      }
    }

    return { itemNameSnapshot: item.name, variantNameSnapshot, unitPricePaise, addons };
  }
}
