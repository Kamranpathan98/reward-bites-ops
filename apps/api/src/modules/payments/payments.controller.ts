import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  recordPaymentRequestSchema,
  type PaymentsListResponse,
  type RecordPaymentRequest,
  type RecordPaymentResponse,
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
import { PaymentsService } from './payments.service';
import type { ActingUser } from './payments.types';

function actorFrom(user: AuthenticatedUser): ActingUser {
  return {
    userId: user.userId,
    tenantId: user.tenantId as string,
    membershipId: user.membershipId as string,
    actorKind: 'staff',
  };
}

@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payments')
  @RequirePermission('payments.record')
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recordPaymentRequestSchema)) body: RecordPaymentRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RecordPaymentResponse> {
    const { result, replay } = await this.paymentsService.record(actorFrom(user), body);
    if (replay) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replay', 'true');
    } else {
      res.status(HttpStatus.CREATED);
    }
    return { data: result };
  }

  @Get('bills/:id/payments')
  @RequirePermission('payments.read')
  async listForBill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentsListResponse> {
    return { data: await this.paymentsService.listForBill(user.tenantId as string, id) };
  }
}
