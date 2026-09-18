import type { TransactionContext } from './transaction-context';

/**
 * `tenant_counter(tenant_id, counter_name, value, reset_daily)` under row
 * lock — architecture section 8/11: "order_number ... from a tenant_counter
 * table under SELECT ... FOR UPDATE." First real caller is `order_number`
 * (Gate 6); `bill_number` (Gate 8) will use the same helper.
 *
 * A single atomic `INSERT ... ON CONFLICT DO NOTHING` + `UPDATE ...
 * RETURNING` — the `UPDATE` itself is the lock (no separate `SELECT ...
 * FOR UPDATE` needed, which would just be a second statement racing the
 * same row). When `resetDaily` is true, the CASE expression checks whether
 * the row's `updated_at` falls on a different calendar day than now, both
 * converted to the tenant's own timezone (`tenant.timezone`), and restarts
 * the sequence at 1 instead of incrementing.
 */
export async function nextTenantCounterValue(
  tx: TransactionContext,
  tenantId: string,
  counterName: string,
  resetDaily: boolean,
): Promise<number> {
  await tx.query(
    `INSERT INTO tenant_counter (tenant_id, counter_name, value, reset_daily)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (tenant_id, counter_name) DO NOTHING`,
    [tenantId, counterName, resetDaily],
  );

  const result = await tx.query<{ value: string }>(
    `UPDATE tenant_counter tc
        SET value = CASE
                       WHEN tc.reset_daily
                            AND (tc.updated_at AT TIME ZONE t.timezone)::date
                                <> (now() AT TIME ZONE t.timezone)::date
                       THEN 1
                       ELSE tc.value + 1
                     END,
            updated_at = now()
       FROM tenant t
      WHERE tc.tenant_id = $1 AND tc.counter_name = $2 AND t.id = tc.tenant_id
      RETURNING tc.value`,
    [tenantId, counterName],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `nextTenantCounterValue: tenant ${tenantId} not found while incrementing ${counterName}`,
    );
  }
  return Number(row.value);
}
