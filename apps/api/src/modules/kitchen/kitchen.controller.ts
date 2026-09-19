import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  kitchenOrdersQuerySchema,
  type KitchenOrdersQuery,
  type KitchenOrdersResponse,
} from '@rewardbite/contracts';
import {
  AuthGuard,
  CurrentUser,
  PermissionGuard,
  RequirePermission,
  type AuthenticatedUser,
} from '../../common/guards';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { KitchenService } from './kitchen.service';

@Controller('kitchen')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Get('orders')
  @RequirePermission('kitchen.read')
  async getOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(kitchenOrdersQuerySchema)) query: KitchenOrdersQuery,
  ): Promise<KitchenOrdersResponse> {
    return this.kitchenService.getOrders(user.tenantId as string, query);
  }
}
