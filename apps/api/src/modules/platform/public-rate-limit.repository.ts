import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';

/**
 * `public_rate_limit` (architecture section 9's table catalog, pulled
 * forward for signup — see the table's own migration comment). One atomic
 * upsert per check: if the existing row's window has expired, resets to
 * count 1 under a fresh window; otherwise increments in place. Returns the
 * count *after* this call, so the caller compares against its own limit —
 * no separate SELECT-then-decide, which would race under concurrent
 * requests for the same key.
 */
@Injectable()
export class PublicRateLimitRepository {
  async touch(
    tx: TransactionContext,
    key: string,
    windowMinutes: number,
  ): Promise<{ count: number }> {
    const result = await tx.query<{ count: number }>(
      `INSERT INTO public_rate_limit (key, window_start, count)
       VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE
           WHEN public_rate_limit.window_start < now() - ($2 || ' minutes')::interval THEN 1
           ELSE public_rate_limit.count + 1
         END,
         window_start = CASE
           WHEN public_rate_limit.window_start < now() - ($2 || ' minutes')::interval THEN now()
           ELSE public_rate_limit.window_start
         END
       RETURNING count`,
      [key, windowMinutes],
    );
    const row = result.rows[0];
    if (!row) throw new Error('public_rate_limit upsert returned no row');
    return { count: row.count };
  }
}
