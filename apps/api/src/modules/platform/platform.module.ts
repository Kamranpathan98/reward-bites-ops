import { Module } from '@nestjs/common';
import { ConfigModule } from '../../common/config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PlatformBootstrapGuard } from './platform-bootstrap.guard';
import { PlatformController } from './platform.controller';
import { PlatformDbModule } from './platform-db.module';
import { PlatformService } from './platform.service';

/**
 * `platform` depends on `tenancy` and `identity` per the module graph
 * (architecture section 4) — both already export the repositories this
 * needs (TenantRepository, RoleRepository, MembershipRepository,
 * UserRepository). Neither of those modules ever imports `platform` back.
 */
@Module({
  imports: [ConfigModule, PlatformDbModule, TenancyModule, IdentityModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformBootstrapGuard],
})
export class PlatformModule {}
