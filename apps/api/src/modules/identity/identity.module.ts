import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginAttemptRepository } from './login-attempt.repository';
import { MembershipRepository } from './membership.repository';
import { PermissionRepository } from './permission.repository';
import { RbacController } from './rbac.controller';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * `identity` depends on `tenancy` per the module graph (architecture
 * section 4) — imported here for TenantRepository, used by AuthService's
 * login/me flows. `identity` is never imported BACK by `tenancy` (see
 * TenancyModule's own comment) — AuthGuard/TenantGuard/PermissionGuard
 * are common/guards + the global SecurityModule, not this module.
 */
@Module({
  imports: [DbModule, TenancyModule],
  controllers: [AuthController, UsersController, RbacController],
  providers: [
    AuthService,
    UsersService,
    UserRepository,
    MembershipRepository,
    RoleRepository,
    PermissionRepository,
    RefreshTokenRepository,
    LoginAttemptRepository,
  ],
  // AuthService exported for the platform module's SignupService, which
  // reuses AuthService.login() verbatim for signup auto-login rather than
  // issuing tokens a second, different way (onboarding task section 7).
  exports: [UserRepository, MembershipRepository, RoleRepository, AuthService],
})
export class IdentityModule {}
