import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { TenantController } from './tenant.controller';
import { TenantRepository } from './tenant.repository';

/**
 * `tenancy` depends on nothing per the module graph (architecture section
 * 4). Its controller uses AuthGuard/TenantGuard/PermissionGuard from
 * common/guards, which only need the global SecurityModule (registered
 * once in AppModule) — no import of IdentityModule needed here.
 */
@Module({
  imports: [DbModule],
  controllers: [TenantController],
  providers: [TenantRepository],
  exports: [TenantRepository],
})
export class TenancyModule {}
