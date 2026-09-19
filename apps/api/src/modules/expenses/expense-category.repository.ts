import { Injectable } from '@nestjs/common';
import { DEFAULT_EXPENSE_CATEGORIES } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface ExpenseCategoryRow {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawExpenseCategory {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(raw: RawExpenseCategory): ExpenseCategoryRow {
  return {
    id: raw.id,
    tenantId: raw.tenant_id,
    name: raw.name,
    sortOrder: raw.sort_order,
    isActive: raw.is_active,
    deletedAt: raw.deleted_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class ExpenseCategoryRepository {
  /**
   * Seed the canonical default categories for a new or backfilled tenant.
   * Uses client-minted UUID v7 for each category, ignoring if already exists.
   */
  async seedDefaults(tx: TransactionContext, tenantId: string): Promise<void> {
    for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
      await tx.query(
        `INSERT INTO expense_category (id, tenant_id, name, sort_order, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING`,
        [newId(), tenantId, cat.name, cat.sortOrder],
      );
    }
  }

  async findById(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<ExpenseCategoryRow | null> {
    const res = await tx.query<RawExpenseCategory>(
      `SELECT * FROM expense_category WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByName(
    tx: TransactionContext,
    tenantId: string,
    name: string,
  ): Promise<ExpenseCategoryRow | null> {
    const res = await tx.query<RawExpenseCategory>(
      `SELECT * FROM expense_category
        WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, name],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async list(
    tx: TransactionContext,
    tenantId: string,
    includeInactive = false,
  ): Promise<ExpenseCategoryRow[]> {
    const res = await tx.query<RawExpenseCategory>(
      `SELECT * FROM expense_category
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          ${includeInactive ? '' : 'AND is_active = true'}
        ORDER BY sort_order ASC, name ASC`,
      [tenantId],
    );
    return res.rows.map(mapRow);
  }

  async create(
    tx: TransactionContext,
    input: {
      tenantId: string;
      name: string;
      sortOrder?: number | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<ExpenseCategoryRow> {
    const id = newId();
    const res = await tx.query<RawExpenseCategory>(
      `INSERT INTO expense_category (id, tenant_id, name, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        id,
        input.tenantId,
        input.name,
        input.sortOrder ?? 0,
        input.isActive ?? true,
      ],
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to insert expense category');
    }
    return mapRow(row);
  }

  async update(
    tx: TransactionContext,
    tenantId: string,
    id: string,
    changes: {
      name?: string | undefined;
      sortOrder?: number | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<ExpenseCategoryRow | null> {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [tenantId, id];
    let pIdx = 3;

    if (changes.name !== undefined) {
      sets.push(`name = $${pIdx++}`);
      params.push(changes.name);
    }
    if (changes.sortOrder !== undefined) {
      sets.push(`sort_order = $${pIdx++}`);
      params.push(changes.sortOrder);
    }
    if (changes.isActive !== undefined) {
      sets.push(`is_active = $${pIdx++}`);
      params.push(changes.isActive);
    }

    const res = await tx.query<RawExpenseCategory>(
      `UPDATE expense_category
          SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      params,
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async softDelete(
    tx: TransactionContext,
    tenantId: string,
    id: string,
  ): Promise<ExpenseCategoryRow | null> {
    const res = await tx.query<RawExpenseCategory>(
      `UPDATE expense_category
          SET deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async countExpensesForCategory(
    tx: TransactionContext,
    tenantId: string,
    categoryId: string,
  ): Promise<number> {
    const res = await tx.query<{ count: string }>(
      `SELECT count(*)::text as count
         FROM expense
        WHERE tenant_id = $1 AND category_id = $2 AND deleted_at IS NULL`,
      [tenantId, categoryId],
    );
    return Number(res.rows[0]?.count ?? '0');
  }
}
