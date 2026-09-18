import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  closeSessionRequestSchema,
  type CloseSessionRequest,
  type SessionResponse,
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
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get(':id')
  @RequirePermission('sessions.read')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SessionResponse> {
    const data = await this.sessionsService.getById(user.tenantId as string, id);
    return { data };
  }

  @Post(':id/close')
  @RequirePermission('sessions.close')
  @HttpCode(HttpStatus.OK)
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(closeSessionRequestSchema)) body: CloseSessionRequest,
  ): Promise<{ data: true }> {
    await this.sessionsService.close(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body.reason,
    );
    return { data: true };
  }
}
