import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';

export interface PermissionRow {
  key: string;
  description: string;
}

/** `permission` is a global catalog (no tenant_id) — see R__rls_policies.sql. */
@Injectable()
export class PermissionRepository {
  async listAll(tx: TransactionContext): Promise<PermissionRow[]> {
    const result = await tx.query<{ key: string; description: string }>(
      `SELECT key, description FROM permission ORDER BY key ASC`,
    );
    return result.rows.map((row) => ({ key: row.key, description: row.description }));
  }
}
