import { describe, expect, it } from 'vitest';
import {
  MAX_PAISE,
  applyDiscountRequestSchema,
  billSummarySchema,
  createBillRequestSchema,
  discardBillRequestSchema,
  discountInputSchema,
  finalizeBillRequestSchema,
  listBillsQuerySchema,
  paiseSchema,
  voidBillRequestSchema,
} from './bills';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '550e8400-e29b-41d4-a716-446655440001';
const UUID_C = '550e8400-e29b-41d4-a716-446655440002';

describe('bill money bounds', () => {
  it('accepts paise up to MAX_SAFE_INTEGER and rejects beyond it', () => {
    expect(paiseSchema.safeParse(MAX_PAISE).success).toBe(true);
    expect(paiseSchema.safeParse(MAX_PAISE + 1).success).toBe(false);
    expect(paiseSchema.safeParse(-1).success).toBe(false);
    expect(paiseSchema.safeParse(1.5).success).toBe(false);
  });
});

describe('createBillRequestSchema', () => {
  const valid = {
    idempotencyKey: UUID_A,
    sessionId: UUID_B,
    orderIds: [UUID_C],
    customerName: 'Rahul',
  };

  it('accepts a valid request', () => {
    expect(createBillRequestSchema.parse(valid)).toEqual(valid);
  });

  it('requires the idempotency key to be a UUID (same convention as POST /orders)', () => {
    expect(
      createBillRequestSchema.safeParse({ ...valid, idempotencyKey: 'idemp-1234' }).success,
    ).toBe(false);
  });

  it('rejects empty and duplicate orderIds', () => {
    expect(createBillRequestSchema.safeParse({ ...valid, orderIds: [] }).success).toBe(false);
    expect(
      createBillRequestSchema.safeParse({ ...valid, orderIds: [UUID_C, UUID_C] }).success,
    ).toBe(false);
  });

  it('strips server-owned fields', () => {
    const parsed = createBillRequestSchema.parse({ ...valid, status: 'PAID', subtotalPaise: 1 });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('subtotalPaise');
  });
});

describe('discount contracts', () => {
  it('accepts percent (basis points) and fixed (paise) discounts with an optional reason', () => {
    expect(discountInputSchema.parse({ kind: 'PERCENT', value: 1050 })).toEqual({
      kind: 'PERCENT',
      value: 1050,
    });
    expect(
      discountInputSchema.parse({ kind: 'FIXED', value: 5000, reason: 'Loyal guest' }).kind,
    ).toBe('FIXED');
  });

  it('rejects out-of-range and unknown discounts', () => {
    expect(discountInputSchema.safeParse({ kind: 'PERCENT', value: 0 }).success).toBe(false);
    expect(discountInputSchema.safeParse({ kind: 'PERCENT', value: 10001 }).success).toBe(false);
    expect(discountInputSchema.safeParse({ kind: 'FIXED', value: 0 }).success).toBe(false);
    expect(discountInputSchema.safeParse({ kind: 'BOGO', value: 1 }).success).toBe(false);
  });

  it('uses discount: null to remove a discount', () => {
    expect(
      applyDiscountRequestSchema.parse({ expectedVersion: 1, discount: null }).discount,
    ).toBeNull();
  });
});

describe('finalize / discard / void requests', () => {
  it('validates finalize', () => {
    expect(
      finalizeBillRequestSchema.safeParse({ expectedVersion: 0, expectedGrandTotalPaise: 12300 })
        .success,
    ).toBe(true);
    expect(finalizeBillRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(
      finalizeBillRequestSchema.safeParse({ expectedVersion: 0, expectedGrandTotalPaise: -1 })
        .success,
    ).toBe(false);
  });

  it('validates discard', () => {
    expect(discardBillRequestSchema.safeParse({ expectedVersion: 2 }).success).toBe(true);
  });

  it('requires a non-empty void reason', () => {
    expect(
      voidBillRequestSchema.safeParse({ expectedVersion: 1, reason: 'Wrong table' }).success,
    ).toBe(true);
    expect(voidBillRequestSchema.safeParse({ expectedVersion: 1, reason: '   ' }).success).toBe(
      false,
    );
  });
});

describe('listBillsQuerySchema', () => {
  it('defaults the limit and caps it at 100', () => {
    expect(listBillsQuerySchema.parse({}).limit).toBe(20);
    expect(listBillsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('billSummarySchema', () => {
  const summary = {
    id: UUID_A,
    tableSessionId: UUID_B,
    billNumber: null,
    status: 'DRAFT',
    subtotalPaise: 12349,
    discountPaise: 0,
    roundingPaise: -49,
    grandTotalPaise: 12300,
    paidPaise: 0,
    outstandingPaise: 12300,
    version: 0,
    customerName: null,
    notes: null,
    finalizedAt: null,
    finalizedBy: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    createdBy: UUID_C,
    createdAt: '2026-09-19T12:00:00.000Z',
    updatedAt: '2026-09-19T12:00:00.000Z',
  };

  it('accepts a draft (null bill number) with a signed rounding amount', () => {
    expect(billSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('exposes no tax / service-charge / delivery fields in V1', () => {
    const parsed = billSummarySchema.parse({ ...summary, taxPaise: 5, serviceChargePaise: 5 });
    expect(parsed).not.toHaveProperty('taxPaise');
    expect(parsed).not.toHaveProperty('serviceChargePaise');
  });

  it('rejects an unsafe money value', () => {
    expect(
      billSummarySchema.safeParse({ ...summary, grandTotalPaise: MAX_PAISE + 2 }).success,
    ).toBe(false);
  });
});
