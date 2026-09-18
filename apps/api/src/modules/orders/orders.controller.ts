import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  cancelOrderRequestSchema,
  createOrderRequestSchema,
  listOrdersQuerySchema,
  patchOrderLinesRequestSchema,
  reopenOrderRequestSchema,
  transitionOrderRequestSchema,
  type CancelOrderRequest,
  type CreateOrderRequest,
  type ListOrdersQuery,
  type OrderDetailResponse,
  type OrdersListResponse,
  type PatchOrderLinesRequest,
  type ReopenOrderRequest,
  type TransitionOrderRequest,
} from '@rewardbite/contracts';
import {
  AuthGuard,
  CurrentUser,
  PermissionGuard,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedUser,
} from '../../common/guards';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { OrderTransitionService } from './order-transition.service';
import { OrdersService } from './orders.service';
import type { ActingUser } from './orders.types';

function actorFrom(user: AuthenticatedUser): ActingUser {
  return {
    userId: user.userId,
    tenantId: user.tenantId as string,
    membershipId: user.membershipId as string,
    actorKind: 'staff',
  };
}

@Controller('orders')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly transitionService: OrderTransitionService,
  ) {}

  @Get()
  @RequirePermission('orders.read')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
  ): Promise<OrdersListResponse> {
    const { orders, nextCursor } = await this.ordersService.list(user.tenantId as string, query);
    return { data: orders, meta: { nextCursor } };
  }

  @Get(':id')
  @RequirePermission('orders.read')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderDetailResponse> {
    const data = await this.ordersService.getById(user.tenantId as string, id);
    return { data };
  }

  @Post()
  @RequirePermission('orders.create')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderRequestSchema)) body: CreateOrderRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDetailResponse> {
    const { order, replay } = await this.ordersService.createOrder(actorFrom(user), body);
    if (replay) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replay', 'true');
    } else {
      res.status(HttpStatus.CREATED);
    }
    return { data: order };
  }

  @Patch(':id/lines')
  @RequirePermission('orders.update')
  async editLines(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchOrderLinesRequestSchema)) body: PatchOrderLinesRequest,
  ): Promise<OrderDetailResponse> {
    const data = await this.ordersService.editLines(actorFrom(user), id, body);
    return { data };
  }

  @Post(':id/transition')
  @RequireAnyPermission('orders.transition.front', 'orders.transition.kitchen')
  @HttpCode(HttpStatus.OK)
  async transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionOrderRequestSchema)) body: TransitionOrderRequest,
  ): Promise<OrderDetailResponse> {
    const data = await this.transitionService.transition(actorFrom(user), id, body);
    return { data };
  }

  @Post(':id/cancel')
  @RequirePermission('orders.cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelOrderRequestSchema)) body: CancelOrderRequest,
  ): Promise<OrderDetailResponse> {
    const data = await this.transitionService.cancel(actorFrom(user), id, body);
    return { data };
  }

  @Post(':id/reopen')
  @RequirePermission('orders.reopen')
  @HttpCode(HttpStatus.OK)
  async reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reopenOrderRequestSchema)) body: ReopenOrderRequest,
  ): Promise<OrderDetailResponse> {
    const data = await this.transitionService.reopen(actorFrom(user), id, body);
    return { data };
  }
}
