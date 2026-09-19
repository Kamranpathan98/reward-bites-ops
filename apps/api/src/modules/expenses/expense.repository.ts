import { Injectable } from '@nestjs/common';
import type { ExpensePaymentMethod } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { toPaise } from '../../common/money/paise';
import { newId } from '../../common/security/id';

export interface ExpenseRow {
  id: string;
  tenantId: string;
  categoryId: string;
  categoryName: string;
  amountPaise: number;
  description: string;
  expenseDate: string; // YYYY-MM-DD
  paymentMethod: ExpensePaymentMethod;
  version: number;
  createdBy: string;
  updatedBy: string | null;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawExpense {
  id: string;
  tenant_id: string;
  category_id: string;
  category_name?: string;
  amount_paise: string;
  description: string;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  version: number;
  created_by: string;
  updated_by: string | null;
  idempotency_key: string;
  idempotency_fingerprint: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(raw: RawExpense): ExpenseRow {
  return {
    id: raw.id,
    tenantId: raw.tenant_id,
    categoryId: raw.category_id,
    categoryName: raw.category_name ?? '',
    amountPaise: toPaise(raw.amount_paise, 'amount_paise'),
    description: raw.description,
    expenseDate:
      typeof raw.expense_date === 'string'
        ? raw.expense_date.substring(0, 10)
        : (raw.expense_date as unknown as Date).toISOString().substring(0, 10),
    paymentMethod: raw.payment_method,
    version: raw.version,
    createdBy: raw.created_by,
    updatedBy: raw.updated_by,
    idempotencyKey: raw.idempotency_key,
    idempotencyFingerprint: raw.idempotency_fingerprint,
    deletedAt: raw.deleted_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export interface CreateExpenseInput {
  tenantId: string;
  categoryId: string;
  amountPaise: number;
  description: string;
  expenseDate: string; // YYYY-MM-DD
  paymentMethod: ExpensePaymentMethod;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  createdBy: string;
}

export interface UpdateExpenseInput {
  categoryId?: string | undefined;
  amountPaise?: number | undefined;
  description?: string | undefined;
  expenseDate?: string | undefined;
  paymentMethod?: ExpensePaymentMethod | undefined;
  expectedVersion: number;
  updatedBy: string;
}

export interface ListExpensesFilter {
  tenantId: string;
  categoryId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

@Injectable()
export class ExpenseRepository {
  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<ExpenseRow | null> {
    const res = await tx.query<RawExpense>(
      `SELECT e.*, c.name as category_name
         FROM expense e
         JOIN expense_category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
        WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`,
      [tenantId, id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByIdempotencyKey(
    tx: TransactionContext,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<ExpenseRow | null> {
    const res = await tx.query<RawExpense>(
      `SELECT e.*, c.name as category_name
         FROM expense e
         JOIN expense_category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
        WHERE e.tenant_id = $1 AND e.idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(tx: TransactionContext, input: CreateExpenseInput): Promise<ExpenseRow> {
    const id = newId();
    await tx.query(
      `INSERT INTO expense (
        id, tenant_id, category_id, amount_paise, description,
        expense_date, payment_method, idempotency_key, idempotency_fingerprint, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        input.tenantId,
        input.categoryId,
        input.amountPaise,
        input.description,
        input.expenseDate,
        input.paymentMethod,
        input.idempotencyKey,
        input.idempotencyFingerprint,
        input.createdBy,
      ],
    );

    return (await this.findById(tx, input.tenantId, id))!;
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    input: UpdateExpenseInput,
  ): Promise<{ row: ExpenseRow | null; conflict: boolean }> {
    const sets: string[] = ['updated_at = now()', 'version = version + 1', 'updated_by = $4'];
    const params: unknown[] = [tenantId, id, input.expectedVersion, input.updatedBy];
    let pIdx = 5;

    if (input.categoryId !== undefined) {
      sets.push(`category_id = $${pIdx++}`);
      params.push(input.categoryId);
    }
    if (input.amountPaise !== undefined) {
      sets.push(`amount_paise = $${pIdx++}`);
      params.push(input.amountPaise);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${pIdx++}`);
      params.push(input.description);
    }
    if (input.expenseDate !== undefined) {
      sets.push(`expense_date = $${pIdx++}`);
      params.push(input.expenseDate);
    }
    if (input.paymentMethod !== undefined) {
      sets.push(`payment_method = $${pIdx++}`);
      params.push(input.paymentMethod);
    }

    const res = await tx.query<RawExpense>(
      `UPDATE expense
          SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2 AND version = $3 AND deleted_at IS NULL
        RETURNING *`,
      params,
    );

    if (res.rows.length > 0) {
      const updated = await this.findById(tx, tenantId, id);
      return { row: updated, conflict: false };
    }

    // Check if the record exists at all (deleted or wrong version)
    const exists = await tx.query<{ version: number }>(
      `SELECT version FROM expense WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );

    if (exists.rows.length > 0) {
      // Row exists but version didn't match -> Optimistic Lock Conflict!
      return { row: null, conflict: true };
    }

    // Not found
    return { row: null, conflict: false };
  }

  async softDelete(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<ExpenseRow | null> {
    const res = await tx.query<RawExpense>(
      `UPDATE expense
          SET deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Keyset pagination on (expense_date DESC, created_at DESC, id DESC).
   * Cursor encodes `${expense_date}_${created_at_iso}_${id}`.
   */
  async list(
    tx: TransactionContext,
    filter: ListExpensesFilter,
  ): Promise<{ items: ExpenseRow[]; nextCursor: string | null }> {
    const wheres: string[] = ['e.tenant_id = $1', 'e.deleted_at IS NULL'];
    const params: unknown[] = [filter.tenantId];
    let pIdx = 2;

    if (filter.categoryId) {
      wheres.push(`e.category_id = $${pIdx++}`);
      params.push(filter.categoryId);
    }
    if (filter.from) {
      wheres.push(`e.expense_date >= $${pIdx++}`);
      params.push(filter.from);
    }
    if (filter.to) {
      wheres.push(`e.expense_date <= $${pIdx++}`);
      params.push(filter.to);
    }

    if (filter.cursor) {
      try {
        const decoded = Buffer.from(filter.cursor, 'base64url').toString('utf8');
        const [cursorDate, cursorCreatedAt, cursorId] = decoded.split('|');
        if (cursorDate && cursorCreatedAt && cursorId) {
          wheres.push(
            `(e.expense_date, e.created_at, e.id) < ($${pIdx++}::date, $${pIdx++}::timestamptz, $${pIdx++}::uuid)`,
          );
          params.push(cursorDate, cursorCreatedAt, cursorId);
        }
      } catch {
        // Ignore invalid cursor
      }
    }

    const whereClause = wheres.join(' AND ');
    const fetchLimit = filter.limit + 1;

    const dataRes = await tx.query<RawExpense>(
      `SELECT e.*, c.name as category_name
         FROM expense e
         JOIN expense_category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
        WHERE ${whereClause}
        ORDER BY e.expense_date DESC, e.created_at DESC, e.id DESC
        LIMIT $${pIdx++}`,
      [...params, fetchLimit],
    );

    const hasMore = dataRes.rows.length > filter.limit;
    const rows = hasMore ? dataRes.rows.slice(0, filter.limit) : dataRes.rows;

    let nextCursor: string | null = null;
    const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
    if (hasMore && last) {
      const dateStr =
        typeof last.expense_date === 'string'
          ? last.expense_date.substring(0, 10)
          : (last.expense_date as unknown as Date).toISOString().substring(0, 10);
      const rawCursor = `${dateStr}|${last.created_at.toISOString()}|${last.id}`;
      nextCursor = Buffer.from(rawCursor, 'utf8').toString('base64url');
    }

    return {
      items: rows.map(mapRow),
      nextCursor,
    };
  }
}
