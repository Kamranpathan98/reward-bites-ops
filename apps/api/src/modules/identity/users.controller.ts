import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  inviteUserRequestSchema,
  patchMembershipRequestSchema,
  type InviteUserRequest,
  type PatchMembershipRequest,
  type UsersListResponse,
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
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users.read')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<UsersListResponse> {
    const data = await this.usersService.list(user.tenantId as string);
    return { data };
  }

  @Post('invite')
  @RequirePermission('users.manage')
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(inviteUserRequestSchema)) body: InviteUserRequest,
  ): Promise<{ data: { membershipId: string } }> {
    const data = await this.usersService.invite(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data };
  }

  @Patch(':membershipId')
  @RequirePermission('users.manage')
  async patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(patchMembershipRequestSchema)) body: PatchMembershipRequest,
  ): Promise<{ data: true }> {
    await this.usersService.patch(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      membershipId,
      body,
    );
    return { data: true };
  }

  @Delete(':membershipId/sessions')
  @RequirePermission('users.manage')
  @HttpCode(HttpStatus.OK)
  async revokeSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('membershipId') membershipId: string,
  ): Promise<{ data: true }> {
    await this.usersService.revokeSessions(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      membershipId,
    );
    return { data: true };
  }
}
