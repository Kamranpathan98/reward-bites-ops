import { describe, expect, it } from 'vitest';
import {
  createExpenseRequestSchema,
  DEFAULT_EXPENSE_CATEGORIES,
  expensePaymentMethodSchema,
  updateExpenseRequestSchema,
  dashboardSummarySchema,
  dashboardBreakdownSchema,
} from './index';

describe('Gate 10 contracts', () => {
  it('defines exactly 9 canonical default expense categories in order', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).toHaveLength(9);
    expect(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name)).toEqual([
      'Ingredients & Groceries',
      'Dairy & Produce',
      'Meat & Poultry',
      'Beverages & Alcohol',
      'Packaging & Disposables',
      'Utilities (Gas, Water, Electricity)',
      'Rent & Maintenance',
      'Staff Welfare & Daily Wages',
      'Miscellaneous Supplies',
    ]);
  });

  it('validates expense payment methods', () => {
    expect(expensePaymentMethodSchema.safeParse('CASH').success).toBe(true);
    expect(expensePaymentMethodSchema.safeParse('UPI').success).toBe(true);
    expect(expensePaymentMethodSchema.safeParse('BANK_TRANSFER').success).toBe(true);
    expect(expensePaymentMethodSchema.safeParse('CARD').success).toBe(true);
    expect(expensePaymentMethodSchema.safeParse('OTHER').success).toBe(true);
    expect(expensePaymentMethodSchema.safeParse('UPI_STATIC').success).toBe(false);
  });

  it('validates create expense request', () => {
    const valid = {
      idempotencyKey: '018f3a00-0000-7000-8000-000000000001',
      categoryId: '018f3a00-0000-7000-8000-000000000002',
      amountPaise: 150000,
      expenseDate: '2026-09-19',
      description: 'Vegetables from wholesale market',
      paymentMethod: 'CASH',
    };
    expect(createExpenseRequestSchema.safeParse(valid).success).toBe(true);

    expect(createExpenseRequestSchema.safeParse({ ...valid, amountPaise: 0 }).success).toBe(false);
    expect(createExpenseRequestSchema.safeParse({ ...valid, amountPaise: -500 }).success).toBe(false);
    expect(createExpenseRequestSchema.safeParse({ ...valid, expenseDate: '19-09-2026' }).success).toBe(false);
  });

  it('validates update expense request with expectedVersion', () => {
    const valid = {
      expectedVersion: 0,
      description: 'Updated note',
    };
    expect(updateExpenseRequestSchema.safeParse(valid).success).toBe(true);
    expect(updateExpenseRequestSchema.safeParse({ description: 'Missing version' }).success).toBe(false);
  });

  it('validates dashboard summary schema', () => {
    const valid = {
      period: 'today',
      businessDate: '2026-09-19',
      dateRange: { from: '2026-09-19T04:00:00.000Z', to: '2026-09-20T03:59:59.999Z' },
      orders: { completed: 10, cancelled: 1 },
      revenuePaise: 500000,
      collectedPaise: 500000,
      collectedByMethod: { cashPaise: 200000, upiPaise: 300000 },
      outstandingPaise: 0,
      expensesPaise: 120000,
      operatingResultPaise: 380000,
      aovPaise: 50000,
      disclaimer: 'Operating result is revenue minus recorded expenses.',
    };
    expect(dashboardSummarySchema.safeParse(valid).success).toBe(true);
  });

  it('validates dashboard breakdown schema', () => {
    const valid = {
      period: 'today',
      by: 'expense_category',
      dateRange: { from: '2026-09-19T04:00:00.000Z', to: '2026-09-20T03:59:59.999Z' },
      items: [
        { key: 'cat-1', label: 'Dairy & Produce', count: 3, totalPaise: 45000 },
      ],
      totalPaise: 45000,
    };
    expect(dashboardBreakdownSchema.safeParse(valid).success).toBe(true);
  });
});

