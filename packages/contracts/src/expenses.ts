import { z } from 'zod';
import { positivePaiseSchema } from './bills';

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Ingredients & Groceries', sortOrder: 1 },
  { name: 'Dairy & Produce', sortOrder: 2 },
  { name: 'Meat & Poultry', sortOrder: 3 },
  { name: 'Beverages & Alcohol', sortOrder: 4 },
  { name: 'Packaging & Disposables', sortOrder: 5 },
  { name: 'Utilities (Gas, Water, Electricity)', sortOrder: 6 },
  { name: 'Rent & Maintenance', sortOrder: 7 },
  { name: 'Staff Welfare & Daily Wages', sortOrder: 8 },
  { name: 'Miscellaneous Supplies', sortOrder: 9 },
] as const;

export const expensePaymentMethodSchema = z.enum([
  'CASH',
  'UPI',
  'BANK_TRANSFER',
  'CARD',
  'OTHER',
]);
export type ExpensePaymentMethod = z.infer<typeof expensePaymentMethodSchema>;

export const expenseCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const expenseCategoryListResponseSchema = z.object({
  data: z.array(expenseCategorySchema),
});
export type ExpenseCategoryListResponse = z.infer<typeof expenseCategoryListResponseSchema>;

export const createExpenseCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().optional(),
});
export type CreateExpenseCategoryRequest = z.infer<typeof createExpenseCategoryRequestSchema>;

export const updateExpenseCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateExpenseCategoryRequest = z.infer<typeof updateExpenseCategoryRequestSchema>;

export const expenseSummarySchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  amountPaise: positivePaiseSchema,
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string(),
  paymentMethod: expensePaymentMethodSchema,
  version: z.number().int(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;

export const expenseDetailResponseSchema = z.object({
  data: expenseSummarySchema,
});
export type ExpenseDetailResponse = z.infer<typeof expenseDetailResponseSchema>;

export const expensesListResponseSchema = z.object({
  data: z.array(expenseSummarySchema),
  meta: z.object({
    nextCursor: z.string().nullable(),
  }),
});
export type ExpensesListResponse = z.infer<typeof expensesListResponseSchema>;

export const createExpenseRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountPaise: positivePaiseSchema,
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
  paymentMethod: expensePaymentMethodSchema,
});
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

export const updateExpenseRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  categoryId: z.string().uuid().optional(),
  amountPaise: positivePaiseSchema.optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  paymentMethod: expensePaymentMethodSchema.optional(),
});
export type UpdateExpenseRequest = z.infer<typeof updateExpenseRequestSchema>;

export const listExpensesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

