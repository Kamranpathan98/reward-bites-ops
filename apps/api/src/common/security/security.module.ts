import { Global, Module } from '@nestjs/common';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { DbModule } from '../db';
import { AppJwtService } from './jwt.service';
import { PermissionResolutionService } from './permission-resolution.service';

/**
 * Global auth infrastructure: JWT signing/verification and the 60s
 * permission/security-version caches that `AuthGuard`/`TenantGuard`/
 * `PermissionGuard` (common/guards) depend on. Deliberately NOT part of
 * `IdentityModule` — the architecture (section 4) describes identity as
 * "exposing" these guards to every other module, so the guards themselves
 * (and what they need to function) must not require importing identity's
 * own module, or every module using them (tenancy, platform, ...) would
 * have to import identity too, and identity itself depends on tenancy —
 * a cycle. Making this global breaks that cycle.
 */
@Global()
@Module({
  imports: [DbModule, NestJwtModule.register({})],
  providers: [AppJwtService, PermissionResolutionService],
  exports: [AppJwtService, PermissionResolutionService],
})
export class SecurityModule {}
