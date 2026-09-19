import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { OrdersModule } from '../orders/orders.module';
import { TablesModule } from '../tables/tables.module';
import { BillRepository } from './bill.repository';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';

/**
 * `billing` sits above `orders` and `tables` in the module graph (it reads and
 * links orders and locks table sessions); neither imports it back.
 */
@Module({
  imports: [DbModule, OrdersModule, TablesModule],
  controllers: [BillsController],
  providers: [BillRepository, BillsService],
  exports: [BillRepository],
})
export class BillingModule {}
