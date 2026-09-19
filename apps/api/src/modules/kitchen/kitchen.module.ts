import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { KitchenController } from './kitchen.controller';
import { KitchenRepository } from './kitchen.repository';
import { KitchenService } from './kitchen.service';

@Module({
  imports: [DbModule],
  controllers: [KitchenController],
  providers: [KitchenService, KitchenRepository],
  exports: [KitchenService, KitchenRepository],
})
export class KitchenModule {}
