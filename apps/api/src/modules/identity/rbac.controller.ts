import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import type { PermissionsListResponse, RolesListResponse } from '@rewardbite/contracts';
import {
  AuthGuard,
  CurrentUser,
  PermissionGuard,
  RequirePermission,
  type AuthenticatedUser,
} from '../../common/guards';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { PermissionRepository } from './permission.repository';
import { RoleRepository } from './role.repository';

/**
 * GET /roles, GET /permissions — architecture section 12: "read-only in
 * V1; POST /roles reserved" (not built).
 */
@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class RbacController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly roleRepository: RoleRepository,
    private readonly permissionRepository: PermissionRepository,
  ) {}

  @Get('roles')
  @RequirePermission('users.read')
  async listRoles(@CurrentUser() user: AuthenticatedUser): Promise<RolesListResponse> {
    const tenantId = user.tenantId as string;
    const roles = await withTenantTx(
      this.pool,
      { tenantId, userId: user.userId, actorKind: 'staff' },
      (tx) => this.roleRepository.listForTenant(tx),
    );
    return { data: roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem })) };
  }

  @Get('permissions')
  @RequirePermission('users.read')
  async listPermissions(@CurrentUser() user: AuthenticatedUser): Promise<PermissionsListResponse> {
    const tenantId = user.tenantId as string;
    const permissions = await withTenantTx(
      this.pool,
      { tenantId, userId: user.userId, actorKind: 'staff' },
      (tx) => this.permissionRepository.listAll(tx),
    );
    return { data: permissions };
  }
}
