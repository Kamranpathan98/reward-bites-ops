import type { Pool } from 'pg';
import { runInTransaction } from './transaction-runner';
import type { ActorKind, TransactionContext } from './transaction-context';

export interface GlobalContextInput {
  readonly userId?: string | null;
  readonly actorKind: ActorKind;
}

/**
 * The transaction primitive for operations that touch no tenant-owned
 * table — login, refresh, logout, and platform tenant-provisioning all run
 * before a tenant is known (or, for platform, without one at all).
 * Mirrors `withTenantTx()` exactly except it never sets `app.tenant_id`:
 * any query that accidentally hit a tenant table through this helper would
 * see zero rows under RLS (fail-closed), never someone else's.
 *
 * `app.user_id` / `app.actor_kind` are still set — the architecture
 * describes the platform path the same way (section 7, blueprint section
 * 7): `SET LOCAL app.actor_kind = 'platform'` with no tenant context at all.
 */
export async function withGlobalTx<T>(
  pool: Pool,
  input: GlobalContextInput,
  fn: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  return runInTransaction(
    pool,
    async (client) => {
      await client.query(`select set_config('app.user_id', $1, true)`, [input.userId ?? '']);
      await client.query(`select set_config('app.actor_kind', $1, true)`, [input.actorKind]);
    },
    (client) => {
      const tx: TransactionContext = {
        tenantId: null,
        userId: input.userId ?? null,
        actorKind: input.actorKind,
        query: (text, params) => client.query(text, params),
      };
      return fn(tx);
    },
  );
}
