import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

/**
 * Brute-force counters (architecture section 7): 5 failures -> 15 min lock
 * for that email. `login_attempt` has no tenant_id (login happens before
 * a tenant is known).
 */
@Injectable()
export class LoginAttemptRepository {
  async record(
    tx: TransactionContext,
    input: { email: string; ip?: string | null | undefined; success: boolean },
  ): Promise<void> {
    await tx.query(`INSERT INTO login_attempt (id, email, ip, success) VALUES ($1, $2, $3, $4)`, [
      newId(),
      input.email,
      input.ip ?? null,
      input.success,
    ]);
  }

  /** Count consecutive-window failures for lockout purposes. */
  async countRecentFailures(
    tx: TransactionContext,
    email: string,
    sinceMinutesAgo: number,
  ): Promise<number> {
    const result = await tx.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM login_attempt
        WHERE lower(email) = lower($1)
          AND success = false
          AND at > now() - ($2 || ' minutes')::interval`,
      [email, sinceMinutesAgo],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
