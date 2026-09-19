import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  applyDiscountRequestSchema,
  createBillRequestSchema,
  discardBillRequestSchema,
  finalizeBillRequestSchema,
  listBillsQuerySchema,
  voidBillRequestSchema,
  type ApplyDiscountRequest,
  type BillDetailResponse,
  type BillsListResponse,
  type CreateBillRequest,
  type DiscardBillRequest,
  type FinalizeBillRequest,
  type ListBillsQuery,
  type VoidBillRequest,
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
import type { ActingUser } from './billing.types';
import { BillsService } from './bills.service';

function actorFrom(user: AuthenticatedUser): ActingUser {
  return {
    userId: user.userId,
    tenantId: user.tenantId as string,
    membershipId: user.membershipId as string,
    actorKind: 'staff',
  };
}

@Controller('bills')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get()
  @RequirePermission('bills.read')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listBillsQuerySchema)) query: ListBillsQuery,
  ): Promise<BillsListResponse> {
    const { bills, nextCursor } = await this.billsService.list(user.tenantId as string, query);
    return { data: bills, meta: { nextCursor } };
  }

  @Get(':id')
  @RequirePermission('bills.read')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BillDetailResponse> {
    return { data: await this.billsService.getById(user.tenantId as string, id) };
  }

  @Post()
  @RequirePermission('bills.create')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBillRequestSchema)) body: CreateBillRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BillDetailResponse> {
    const { bill, replay } = await this.billsService.createDraft(actorFrom(user), body);
    if (replay) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replay', 'true');
    } else {
      res.status(HttpStatus.CREATED);
    }
    return { data: bill };
  }

  @Patch(':id/adjustments')
  @RequirePermission('bills.discount')
  async adjustments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(applyDiscountRequestSchema)) body: ApplyDiscountRequest,
  ): Promise<BillDetailResponse> {
    return { data: await this.billsService.applyDiscount(actorFrom(user), id, body) };
  }

  @Post(':id/finalize')
  @RequirePermission('bills.finalize')
  @HttpCode(HttpStatus.OK)
  async finalize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(finalizeBillRequestSchema)) body: FinalizeBillRequest,
  ): Promise<BillDetailResponse> {
    return { data: await this.billsService.finalize(actorFrom(user), id, body) };
  }

  @Post(':id/discard')
  @RequirePermission('bills.create')
  @HttpCode(HttpStatus.OK)
  async discard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(discardBillRequestSchema)) body: DiscardBillRequest,
  ): Promise<BillDetailResponse> {
    return { data: await this.billsService.discard(actorFrom(user), id, body) };
  }

  @Post(':id/void')
  @RequirePermission('bills.void')
  @HttpCode(HttpStatus.OK)
  async void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(voidBillRequestSchema)) body: VoidBillRequest,
  ): Promise<BillDetailResponse> {
    return { data: await this.billsService.void(actorFrom(user), id, body) };
  }
}
