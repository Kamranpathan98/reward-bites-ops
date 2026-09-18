import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { MenuAddonRepository } from './menu-addon.repository';
import { MenuCategoryRepository } from './menu-category.repository';
import { MenuItemAddonRepository } from './menu-item-addon.repository';
import { MenuItemRepository } from './menu-item.repository';
import { MenuSnapshotService } from './menu-snapshot.service';
import { MenuVariantRepository } from './menu-variant.repository';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

/**
 * `menu` sits below `identity` in the module dependency graph (blueprint
 * section 4), a sibling of `tables` — neither depends on the other.
 * `orders`/`public` depend on `menu` later (Gates 6/11), never the reverse.
 */
@Module({
  imports: [DbModule],
  controllers: [MenuController],
  providers: [
    MenuService,
    MenuSnapshotService,
    MenuCategoryRepository,
    MenuItemRepository,
    MenuVariantRepository,
    MenuAddonRepository,
    MenuItemAddonRepository,
  ],
  exports: [MenuSnapshotService, MenuItemRepository, MenuVariantRepository, MenuAddonRepository],
})
export class MenuModule {}
