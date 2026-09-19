import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateExpenseCategoryRequest,
  CreateExpenseRequest,
  ExpenseCategory,
  ExpensesListResponse,
  ExpenseSummary,
  ListExpensesQuery,
  UpdateExpenseCategoryRequest,
  UpdateExpenseRequest,
} from '@rewardbite/contracts';
import {
  DB_POOL,
  isUniqueViolation,
  withTenantTx,
  type Pool,
} from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { canonicalJsonFingerprint } from '../../common/security/idempotency-fingerprint';
import { recordAuditEvent } from '../audit/audit-writer';
import {
  ExpenseCategoryRepository,
  type ExpenseCategoryRow,
} from './expense-category.repository';
import {
  ExpenseRepository,
  type ExpenseRow,
} from './expense.repository';

export interface ActingStaff {
  userId: string;
  tenantId: string;
  membershipId: string;
  actorKind: 'staff';
}

function toCategoryContract(row: ExpenseCategoryRow): ExpenseCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function toExpenseContract(row: ExpenseRow): ExpenseSummary {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    amountPaise: row.amountPaise,
    expenseDate: row.expenseDate,
    description: row.description,
    paymentMethod: row.paymentMethod,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly categoryRepository: ExpenseCategoryRepository,
    private readonly expenseRepository: ExpenseRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  async listCategories(
    actor: ActingStaff,
    includeInactive = false,
  ): Promise<ExpenseCategory[]> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const rows = await this.categoryRepository.list(tx, actor.tenantId, includeInactive);
        return rows.map(toCategoryContract);
      },
    );
  }

  async getCategory(actor: ActingStaff, id: string): Promise<ExpenseCategory> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const row = await this.categoryRepository.findById(tx, actor.tenantId, id);
        if (!row || row.deletedAt !== null) {
          throw new NotFoundException('Expense category not found.');
        }
        return toCategoryContract(row);
      },
    );
  }

  async createCategory(
    actor: ActingStaff,
    input: CreateExpenseCategoryRequest,
  ): Promise<ExpenseCategory> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.categoryRepository.findByName(
          tx,
          actor.tenantId,
          input.name.trim(),
        );
        if (existing) {
          throw new ConflictException(
            `Expense category with name '${input.name}' already exists.`,
          );
        }

        try {
          const row = await this.categoryRepository.create(tx, {
            tenantId: actor.tenantId,
            name: input.name.trim(),
            sortOrder: input.sortOrder,
          });

          await recordAuditEvent(tx, {
            entityType: 'expense_category',
            entityId: row.id,
            action: 'created',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: { name: row.name, sortOrder: row.sortOrder, isActive: row.isActive },
          });

          return toCategoryContract(row);
        } catch (err) {
          if (isUniqueViolation(err, 'expense_category_tenant_name_unique')) {
            throw new ConflictException(
              `Expense category with name '${input.name}' already exists.`,
            );
          }
          throw err;
        }
      },
    );
  }

  async updateCategory(
    actor: ActingStaff,
    id: string,
    input: UpdateExpenseCategoryRequest,
  ): Promise<ExpenseCategory> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.categoryRepository.findById(tx, actor.tenantId, id);
        if (!existing || existing.deletedAt !== null) {
          throw new NotFoundException('Expense category not found.');
        }

        if (input.name && input.name.trim() !== existing.name) {
          const duplicate = await this.categoryRepository.findByName(
            tx,
            actor.tenantId,
            input.name.trim(),
          );
          if (duplicate && duplicate.id !== id) {
            throw new ConflictException(
              `Expense category with name '${input.name}' already exists.`,
            );
          }
        }

        try {
          const updated = await this.categoryRepository.update(tx, actor.tenantId, id, {
            name: input.name?.trim(),
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          });

          if (!updated) {
            throw new NotFoundException('Expense category not found.');
          }

          await recordAuditEvent(tx, {
            entityType: 'expense_category',
            entityId: updated.id,
            action: 'updated',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            before: {
              name: existing.name,
              sortOrder: existing.sortOrder,
              isActive: existing.isActive,
            },
            after: {
              name: updated.name,
              sortOrder: updated.sortOrder,
              isActive: updated.isActive,
            },
          });

          return toCategoryContract(updated);
        } catch (err) {
          if (isUniqueViolation(err, 'expense_category_tenant_name_unique')) {
            throw new ConflictException(
              `Expense category with name '${input.name}' already exists.`,
            );
          }
          throw err;
        }
      },
    );
  }

  async deleteCategory(actor: ActingStaff, id: string): Promise<void> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.categoryRepository.findById(tx, actor.tenantId, id);
        if (!existing || existing.deletedAt !== null) {
          throw new NotFoundException('Expense category not found.');
        }

        // Check if there are any active (non-deleted) expenses using this category
        const expenseCount = await this.categoryRepository.countExpensesForCategory(
          tx,
          actor.tenantId,
          id,
        );
        if (expenseCount > 0) {
          throw new DomainError(
            400,
            'CATEGORY_IN_USE',
            `Cannot delete category because it has ${expenseCount} associated expense(s).`,
            { count: expenseCount },
          );
        }

        const deleted = await this.categoryRepository.softDelete(tx, actor.tenantId, id);
        if (!deleted) {
          throw new NotFoundException('Expense category not found.');
        }

        await recordAuditEvent(tx, {
          entityType: 'expense_category',
          entityId: deleted.id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { name: existing.name },
        });
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------

  async listExpenses(
    actor: ActingStaff,
    query: ListExpensesQuery,
  ): Promise<ExpensesListResponse> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const res = await this.expenseRepository.list(tx, {
          tenantId: actor.tenantId,
          categoryId: query.categoryId,
          from: query.from,
          to: query.to,
          cursor: query.cursor,
          limit: query.limit,
        });

        return {
          data: res.items.map(toExpenseContract),
          meta: {
            nextCursor: res.nextCursor,
          },
        };
      },
    );
  }

  async getExpense(actor: ActingStaff, id: string): Promise<ExpenseSummary> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const row = await this.expenseRepository.findById(tx, actor.tenantId, id);
        if (!row) {
          throw new NotFoundException('Expense not found.');
        }
        return toExpenseContract(row);
      },
    );
  }

  async createExpense(
    actor: ActingStaff,
    input: CreateExpenseRequest,
  ): Promise<{ expense: ExpenseSummary; replay: boolean }> {
    const { idempotencyKey, ...payload } = input;
    const fingerprint = canonicalJsonFingerprint(payload);

    const run = () =>
      withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, actorKind: actor.actorKind },
        async (tx) => {
          // Verify category exists and is active
          const category = await this.categoryRepository.findById(
            tx,
            actor.tenantId,
            input.categoryId,
          );
          if (!category || category.deletedAt !== null) {
            throw new NotFoundException('Expense category not found.');
          }
          if (!category.isActive) {
            throw new BadRequestException('Referenced expense category is inactive.');
          }

          const expense = await this.expenseRepository.create(tx, {
            tenantId: actor.tenantId,
            categoryId: input.categoryId,
            amountPaise: input.amountPaise,
            description: input.description,
            expenseDate: input.expenseDate,
            paymentMethod: input.paymentMethod,
            idempotencyKey,
            idempotencyFingerprint: fingerprint,
            createdBy: actor.userId,
          });

          await recordAuditEvent(tx, {
            entityType: 'expense',
            entityId: expense.id,
            action: 'created',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: {
              categoryId: expense.categoryId,
              amountPaise: expense.amountPaise,
              expenseDate: expense.expenseDate,
              paymentMethod: expense.paymentMethod,
            },
          });

          return { expense: toExpenseContract(expense), replay: false };
        },
      );

    try {
      return await run();
    } catch (err) {
      if (!isUniqueViolation(err, 'expense_tenant_idempotency_key_unique')) {
        if (err instanceof Error && err.message.includes('RB050')) {
          throw new NotFoundException('Referenced expense category does not exist or has been deleted.');
        }
        if (err instanceof Error && err.message.includes('RB051')) {
          throw new BadRequestException('Referenced expense category is inactive.');
        }
        throw err;
      }

      return withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, actorKind: actor.actorKind },
        async (tx) => {
          const existing = await this.expenseRepository.findByIdempotencyKey(
            tx,
            actor.tenantId,
            idempotencyKey,
          );
          if (!existing) {
            throw err;
          }
          if (existing.idempotencyFingerprint !== fingerprint) {
            throw new DomainError(
              409,
              'IDEMPOTENT_MISMATCH',
              'An expense with this idempotency key already exists with a different body.',
            );
          }
          return { expense: toExpenseContract(existing), replay: true };
        },
      );
    }
  }

  async updateExpense(
    actor: ActingStaff,
    id: string,
    input: UpdateExpenseRequest,
  ): Promise<ExpenseSummary> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.expenseRepository.findById(tx, actor.tenantId, id);
        if (!existing) {
          throw new NotFoundException('Expense not found.');
        }

        if (input.categoryId && input.categoryId !== existing.categoryId) {
          const cat = await this.categoryRepository.findById(
            tx,
            actor.tenantId,
            input.categoryId,
          );
          if (!cat || cat.deletedAt !== null) {
            throw new NotFoundException('Expense category not found.');
          }
          if (!cat.isActive) {
            throw new BadRequestException('Referenced expense category is inactive.');
          }
        }

        try {
          const { row: updated, conflict } = await this.expenseRepository.update(
            tx,
            actor.tenantId,
            id,
            {
              categoryId: input.categoryId,
              amountPaise: input.amountPaise,
              description: input.description,
              expenseDate: input.expenseDate,
              paymentMethod: input.paymentMethod,
              expectedVersion: input.expectedVersion,
              updatedBy: actor.userId,
            },
          );

          if (conflict) {
            throw new DomainError(
              409,
              'VERSION_CONFLICT',
              'The expense was updated by another request. Please reload and retry.',
              { currentVersion: existing.version, expectedVersion: input.expectedVersion },
            );
          }

          if (!updated) {
            throw new NotFoundException('Expense not found.');
          }

          await recordAuditEvent(tx, {
            entityType: 'expense',
            entityId: updated.id,
            action: 'updated',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            before: {
              version: existing.version,
              amountPaise: existing.amountPaise,
            },
            after: {
              version: updated.version,
              amountPaise: updated.amountPaise,
            },
          });

          return toExpenseContract(updated);
        } catch (err) {
          if (err instanceof Error && err.message.includes('RB050')) {
            throw new NotFoundException('Referenced expense category does not exist or has been deleted.');
          }
          if (err instanceof Error && err.message.includes('RB051')) {
            throw new BadRequestException('Referenced expense category is inactive.');
          }
          throw err;
        }
      },
    );
  }

  async deleteExpense(actor: ActingStaff, id: string): Promise<void> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.expenseRepository.findById(tx, actor.tenantId, id);
        if (!existing) {
          throw new NotFoundException('Expense not found.');
        }

        const deleted = await this.expenseRepository.softDelete(tx, actor.tenantId, id);
        if (!deleted) {
          throw new NotFoundException('Expense not found.');
        }

        await recordAuditEvent(tx, {
          entityType: 'expense',
          entityId: deleted.id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: { amountPaise: existing.amountPaise, description: existing.description },
        });
      },
    );
  }
}

