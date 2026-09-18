import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * "TenantGuard — bind tenantId onto the request from the verified claim"
 * (architecture section 7/8). Requires `AuthGuard` to have already run.
 * Rejects an "unbound" token (issued when login found zero or multiple
 * memberships) — those may only call `POST /auth/select-tenant`.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.authUser) {
      throw new ForbiddenException('TenantGuard requires AuthGuard to run first');
    }
    if (!request.authUser.tenantId || !request.authUser.membershipId) {
      throw new ForbiddenException(
        'This route requires a tenant-bound session — call POST /auth/select-tenant first.',
      );
    }
    return true;
  }
}
