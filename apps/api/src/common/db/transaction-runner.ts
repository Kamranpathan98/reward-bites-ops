import type { Pool, PoolClient } from 'pg';

/**
 * Shared BEGIN/COMMIT/ROLLBACK/release mechanics used by both
 * `withTenantTx()` and `withGlobalTx()`. `setContext` runs whatever
 * `SET LOCAL` calls that variant needs before the callback executes.
 */
export async function runInTransaction<T>(
  pool: Pool,
  setContext: (client: PoolClient) => Promise<void>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setContext(client);

    const result = await fn(client);

    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection is likely already broken; release(err) below discards it.
    }
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
