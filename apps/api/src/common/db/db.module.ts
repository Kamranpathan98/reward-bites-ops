import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { createPool } from './pool';

export const DB_POOL = 'DB_POOL';

/**
 * Owns the single `pg.Pool` for the process. Nothing outside `common/db`
 * should ever construct its own `Pool` — repositories reach the database
 * exclusively through `withTenantTx()`.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPool({ connectionString: config.env.DATABASE_URL, max: config.env.DB_POOL_MAX }),
    },
  ],
  exports: [DB_POOL],
})
export class DbModule {}
