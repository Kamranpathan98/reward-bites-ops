import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AppJwtService } from '../security/jwt.service';
import { PermissionResolutionService } from '../security/permission-resolution.service';
import type { AuthenticatedUser } from './request-context';

/**
 * "AuthGuard — is this JWT valid, and who is the caller?" (architecture
 * section 7/8). Verifies the bearer JWT and the `rv` (security_version)
 * claim against the live value, then attaches `request.authUser`.
 * Does NOT require a tenant-bound token — `TenantGuard` is the one that
 * does. This lets `POST /auth/select-tenant` accept an "any" tenant-aud
 * token per the architecture's own `T (any)` annotation.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: AppJwtService,
    private readonly permissions: PermissionResolutionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);

    let claims;
    try {
      claims = this.jwt.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const currentVersion = await this.permissions.getCurrentSecurityVersion(claims.sub);
    if (currentVersion === null || currentVersion !== claims.rv) {
      throw new UnauthorizedException('Token no longer valid');
    }

    const authUser: AuthenticatedUser = {
      userId: claims.sub,
      tenantId: claims.tid ?? null,
      membershipId: claims.mid ?? null,
      securityVersion: claims.rv,
      jti: claims.jti,
    };
    request.authUser = authUser;
    return true;
  }
}
