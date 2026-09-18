import type { Pool } from 'pg';
import { runInTransaction } from './transaction-runner';
import type { ActorKind, TransactionContext } from './transaction-context';

export interface TenantContextInput {
  readonly tenantId: string;
  readonly userId?: string | null;
  readonly actorKind: ActorKind;
}

/**
 * The single transaction primitive every service uses to reach
 * tenant-scoped data. Implements the tenant-context flow from the V1
 * Architecture (section 6) and the Implementation Blueprint (section 7):
 *
 *   1. acquire a client from the pool
 *   2. BEGIN
 *   3. SET LOCAL app.tenant_id / app.user_id / app.actor_kind
 *   4. run the callback
 *   5. COMMIT on success / ROLLBACK on failure
 *   6. release the client back to the pool
 *
 * `SET LOCAL` is applied via `select set_config(name, value, true)` rather
 * than the `SET LOCAL name = value` statement form, because `SET` does not
 * accept bound parameters — `set_config(..., true)` is the parameterised
 * equivalent (`is_local = true`) and carries the exact same transaction-only
 * scope. It is never session-level `SET`, which would leak across pooled
 * connections.
 *
 * On error, the underlying connection is destroyed rather than returned to
 * the pool (`client.release(err)`), so a transaction that failed mid-way
 * can never hand a future caller a connection with leftover session state.
 *
 * For operations with no tenant yet (login, refresh, before a tenant is
 * selected), use `withGlobalTx()` instead — it never sets app.tenant_id.
 */
export async function withTenantTx<T>(
  pool: Pool,
  input: TenantContextInput,
  fn: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  return runInTransaction(
    pool,
    async (client) => {
      await client.query(`select set_config('app.tenant_id', $1, true)`, [input.tenantId]);
      await client.query(`select set_config('app.user_id', $1, true)`, [input.userId ?? '']);
      await client.query(`select set_config('app.actor_kind', $1, true)`, [input.actorKind]);
    },
    (client) => {
      const tx: TransactionContext = {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        actorKind: input.actorKind,
        query: (text, params) => client.query(text, params),
      };
      return fn(tx);
    },
  );
}
