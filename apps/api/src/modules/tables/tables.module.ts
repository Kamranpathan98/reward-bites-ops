import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { RestaurantTableRepository } from './restaurant-table.repository';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { TableQrTokenRepository } from './table-qr-token.repository';
import { TableSessionRepository } from './table-session.repository';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

/**
 * `tables` sits below `identity` in the module dependency graph (blueprint
 * section 4) and has no dependency on any other business module — `orders`
 * and `public` depend on it later (Gates 6/11), never the reverse.
 */
@Module({
  imports: [DbModule],
  controllers: [TablesController, SessionsController],
  providers: [
    TablesService,
    SessionsService,
    RestaurantTableRepository,
    TableQrTokenRepository,
    TableSessionRepository,
  ],
  exports: [RestaurantTableRepository, TableSessionRepository],
})
export class TablesModule {}
