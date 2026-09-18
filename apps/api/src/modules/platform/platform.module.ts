import { Module } from '@nestjs/common';
import { ConfigModule } from '../../common/config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PlatformBootstrapGuard } from './platform-bootstrap.guard';
import { PlatformController } from './platform.controller';
import { PlatformDbModule } from './platform-db.module';
import { PlatformService } from './platform.service';
import { PublicRateLimitRepository } from './public-rate-limit.repository';
import { SignupController } from './signup.controller';
import { SignupRateLimitGuard } from './signup-rate-limit.guard';
import { SignupService } from './signup.service';

/**
 * `platform` depends on `tenancy` and `identity` per the module graph
 * (architecture section 4) — both already export the repositories this
 * needs (TenantRepository, RoleRepository, MembershipRepository,
 * UserRepository, and now AuthService for signup auto-login). Neither of
 * those modules ever imports `platform` back.
 *
 * `SignupController`/`SignupService` (self-service onboarding) live here,
 * not in `identity`, because provisioning a brand-new tenant requires the
 * `app_platform` DB pool this module already owns — see
 * docs/IMPLEMENTATION_STATUS.md "Onboarding" for the full boundary
 * analysis. They register `POST /auth/signup` as a second, ungated
 * controller sharing the `/auth` path prefix with identity's
 * AuthController; PlatformController's `PlatformBootstrapGuard` is
 * deliberately not applied to them.
 */
@Module({
  imports: [ConfigModule, PlatformDbModule, TenancyModule, IdentityModule],
  controllers: [PlatformController, SignupController],
  providers: [
    PlatformService,
    PlatformBootstrapGuard,
    SignupService,
    SignupRateLimitGuard,
    PublicRateLimitRepository,
  ],
})
export class PlatformModule {}
