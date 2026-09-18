import { Pool } from 'pg';

export interface PoolConfig {
  readonly connectionString: string;
  readonly max: number;
}

/**
 * The only place `apps/api` constructs a `pg.Pool`. Every module reaches
 * the database exclusively through `withTenantTx()`, never through this
 * pool directly (enforced by the `no-restricted-imports` rule on `pg`).
 */
export function createPool(config: PoolConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max,
  });
}
