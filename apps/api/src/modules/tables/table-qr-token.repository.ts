import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface TableQrTokenRow {
  id: string;
  tenantId: string;
  tableId: string;
  token: string;
  status: 'ACTIVE' | 'REVOKED';
}

interface RawRow {
  id: string;
  tenant_id: string;
  table_id: string;
  token: string;
  status: 'ACTIVE' | 'REVOKED';
}

function mapRow(row: RawRow): TableQrTokenRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tableId: row.table_id,
    token: row.token,
    status: row.status,
  };
}

/**
 * `table_qr_token` is tenant-scoped — every method here must run inside
 * `withTenantTx`, as `app_rw`. Resolving a token from the customer-facing
 * side (as `app_public`, with no tenant context) belongs to the `public`
 * module (Gate 11) — out of scope here; Gate 4 only covers the staff-facing
 * issue/regenerate/view-asset flows.
 */
@Injectable()
export class TableQrTokenRepository {
  async findActiveForTable(
    tx: TransactionContext,
    tenantId: string,
    tableId: string,
  ): Promise<TableQrTokenRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT id, tenant_id, table_id, token, status
         FROM table_qr_token
        WHERE tenant_id = $1 AND table_id = $2 AND status = 'ACTIVE'`,
      [tenantId, tableId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Same lookup, row-locked — used by regenerateQr's revoke-old step. */
  async lockActiveForTable(
    tx: TransactionContext,
    tenantId: string,
    tableId: string,
  ): Promise<TableQrTokenRow | null> {
    const result = await tx.query<RawRow>(
      `SELECT id, tenant_id, table_id, token, status
         FROM table_qr_token
        WHERE tenant_id = $1 AND table_id = $2 AND status = 'ACTIVE'
        FOR UPDATE`,
      [tenantId, tableId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async revoke(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    revokedBy: string | null,
  ): Promise<void> {
    await tx.query(
      `UPDATE table_qr_token SET status = 'REVOKED', revoked_at = now(), revoked_by = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, revokedBy],
    );
  }

  async create(
    tx: TransactionContext,
    input: { tenantId: string; tableId: string; token: string },
  ): Promise<{ id: string }> {
    const id = newId();
    await tx.query(
      `INSERT INTO table_qr_token (id, tenant_id, table_id, token) VALUES ($1, $2, $3, $4)`,
      [id, input.tenantId, input.tableId, input.token],
    );
    return { id };
  }

  async listActiveForTables(
    tx: TransactionContext,
    tenantId: string,
    tableIds: string[],
  ): Promise<Set<string>> {
    if (tableIds.length === 0) return new Set();
    const result = await tx.query<{ table_id: string }>(
      `SELECT table_id FROM table_qr_token
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND table_id = ANY($2::uuid[])`,
      [tenantId, tableIds],
    );
    return new Set(result.rows.map((row) => row.table_id));
  }
}
