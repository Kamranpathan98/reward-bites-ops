import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { TenantController } from './tenant.controller';
import { TenantRepository } from './tenant.repository';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

/**
 * `tenancy` depends on nothing per the module graph (architecture section
 * 4). Its controllers use AuthGuard/TenantGuard/PermissionGuard from
 * common/guards, which only need the global SecurityModule (registered
 * once in AppModule) — no import of IdentityModule needed here.
 */
@Module({
  imports: [DbModule],
  controllers: [TenantController, SettingsController],
  providers: [TenantRepository, SettingsRepository, SettingsService],
  exports: [TenantRepository, SettingsRepository],
})
export class TenancyModule {}
