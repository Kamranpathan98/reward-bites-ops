import { Module } from '@nestjs/common';
import { ConfigModule } from '../../common/config/config.module';
import { ConfigService } from '../../common/config/config.service';
import { createPool } from '../../common/db';

export const PLATFORM_DB_POOL = 'PLATFORM_DB_POOL';

/**
 * A separate pool, connected as `app_platform` (PLATFORM_DATABASE_URL),
 * never `app_rw`. Platform operations must run under app_platform's own
 * grant boundary — sharing the app_rw pool would defeat the whole point
 * of having a distinct role (architecture section 6.5).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PLATFORM_DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPool({ connectionString: config.env.PLATFORM_DATABASE_URL, max: 2 }),
    },
  ],
  exports: [PLATFORM_DB_POOL],
})
export class PlatformDbModule {}
