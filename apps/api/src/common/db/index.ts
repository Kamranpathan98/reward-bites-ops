export { createPool } from './pool';
export type { PoolConfig } from './pool';
export { withTenantTx } from './with-tenant-tx';
export type { TenantContextInput } from './with-tenant-tx';
export { withGlobalTx } from './with-global-tx';
export type { GlobalContextInput } from './with-global-tx';
export type { ActorKind, TransactionContext } from './transaction-context';
export { assertNoBypassRls } from './assert-no-bypass-rls';
export { isUniqueViolation } from './pg-errors';
export { nextTenantCounterValue } from './tenant-counter';
export { DB_POOL } from './db.module';
export { DbModule } from './db.module';
// The one authorized re-export of the `pg` Pool type — modules import it
// from here, never `from 'pg'` directly (enforced by eslint.config.cjs).
export type { Pool } from 'pg';
