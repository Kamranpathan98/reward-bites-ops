import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '@rewardbite/contracts';
import { PermissionResolutionService } from '../security/permission-resolution.service';
import { REQUIRE_ANY_PERMISSION_KEY } from './require-any-permission.decorator';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

/**
 * "PermissionGuard — does this membership hold the required permission
 * string?" (architecture section 7/8). Requires `AuthGuard` + `TenantGuard`
 * to have already run. A route with neither `@RequirePermission` nor
 * `@RequireAnyPermission` metadata is allowed through (permission-less
 * routes, e.g. `GET /auth/me`).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionResolutionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_ANY_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if ((!required || required.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authUser = request.authUser;
    if (!authUser?.tenantId || !authUser.membershipId) {
      throw new ForbiddenException('This route requires a tenant-bound session.');
    }

    const granted = await this.permissions.getPermissionsForMembership(
      authUser.tenantId,
      authUser.membershipId,
    );
    const hasAll = !required || required.every((permission) => granted.has(permission));
    const hasAny = !requiredAny || requiredAny.some((permission) => granted.has(permission));
    if (!hasAll || !hasAny) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return true;
  }
}
