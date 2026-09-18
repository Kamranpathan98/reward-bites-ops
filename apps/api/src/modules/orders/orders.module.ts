import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { MenuModule } from '../menu/menu.module';
import { TablesModule } from '../tables/tables.module';
import { OrderLineAddonRepository } from './order-line-addon.repository';
import { OrderLineRepository } from './order-line.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrderTransitionService } from './order-transition.service';
import { OrderRepository } from './order.repository';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * `orders` sits below `tables` and `menu` in the module dependency graph
 * (blueprint section 4: "orders may import from tables and menu") —
 * imported here for `RestaurantTableRepository`/`TableSessionRepository`
 * (session resolution) and `MenuSnapshotService` (`priceLine()`).
 */
@Module({
  imports: [DbModule, TablesModule, MenuModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderTransitionService,
    OrderRepository,
    OrderLineRepository,
    OrderLineAddonRepository,
    OrderStatusHistoryRepository,
  ],
  exports: [OrderRepository, OrderLineRepository],
})
export class OrdersModule {}
