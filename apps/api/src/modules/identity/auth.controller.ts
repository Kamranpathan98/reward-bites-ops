import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  selectTenantRequestSchema,
  type LoginResponse,
  type MeResponse,
  type RefreshResponse,
  type SelectTenantResponse,
} from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { AuthGuard, CurrentUser, TenantGuard, type AuthenticatedUser } from '../../common/guards';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ConfigService } from '../../common/config/config.service';
import { PermissionResolutionService } from '../../common/security/permission-resolution.service';
import { AuthService } from './auth.service';
import { UserRepository } from './user.repository';
import { RoleRepository } from './role.repository';
import { TenantRepository } from '../tenancy/tenant.repository';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionResolutionService,
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly tenantRepository: TenantRepository,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login({
      email: body.email,
      password: body.password,
      ip: req.ip,
    });
    setRefreshCookie(res, this.config, result.rawRefreshToken);
    return { accessToken: result.accessToken, memberships: result.memberships };
  }

  @Post('select-tenant')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async selectTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(selectTenantRequestSchema)) body: { membershipId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SelectTenantResponse> {
    const currentRawRefreshToken = readRefreshCookie(req);
    const result = await this.authService.selectTenant({
      userId: user.userId,
      membershipId: body.membershipId,
      currentRawRefreshToken,
    });
    setRefreshCookie(res, this.config, result.rawRefreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const rawToken = readRefreshCookie(req);
    if (!rawToken) throw new UnauthorizedException('No refresh token provided.');

    const result = await this.authService.refresh(rawToken);
    setRefreshCookie(res, this.config, result.rawRefreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: true }> {
    const rawToken = readRefreshCookie(req);
    if (rawToken) {
      await this.authService.logout(rawToken);
    }
    clearRefreshCookie(res, this.config);
    return { data: true };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    body: { currentPassword: string; newPassword: string },
  ): Promise<{ data: true }> {
    await this.authService.changePassword(user.userId, body.currentPassword, body.newPassword);
    return { data: true };
  }

  @Get('me')
  @UseGuards(AuthGuard, TenantGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const tenantId = user.tenantId as string;
    const membershipId = user.membershipId as string;

    const [userRow, tenant, permissionSet] = await Promise.all([
      withTenantTx(this.pool, { tenantId, userId: user.userId, actorKind: 'staff' }, (tx) =>
        this.userRepository.findById(tx, user.userId),
      ),
      withTenantTx(this.pool, { tenantId, userId: user.userId, actorKind: 'staff' }, (tx) =>
        this.tenantRepository.findById(tx, tenantId),
      ),
      this.permissions.getPermissionsForMembership(tenantId, membershipId),
    ]);

    if (!userRow || !tenant)
      throw new BadRequestException('Current user or tenant could not be resolved.');

    const role = await withTenantTx(
      this.pool,
      { tenantId, userId: user.userId, actorKind: 'staff' },
      async (tx) => {
        // Membership's roleId is looked up via the membership repository in
        // the identity module's own boundary; done inline here to avoid an
        // extra dependency just for one column.
        const result = await tx.query<{ role_id: string }>(
          `SELECT role_id FROM tenant_membership WHERE tenant_id = $1 AND id = $2`,
          [tenantId, membershipId],
        );
        const roleId = result.rows[0]?.role_id;
        return roleId ? this.roleRepository.findById(tx, roleId) : null;
      },
    );

    return {
      user: { id: userRow.id, email: userRow.email, fullName: userRow.fullName },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      membership: { id: membershipId, roleId: role?.id ?? '', roleName: role?.name ?? '' },
      permissions: Array.from(permissionSet),
    };
  }
}
