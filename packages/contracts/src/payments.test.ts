import { describe, expect, it } from 'vitest';
import { paymentMethodSchema, paymentStatusSchema, recordPaymentRequestSchema } from './payments';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '550e8400-e29b-41d4-a716-446655440001';

describe('recordPaymentRequestSchema', () => {
  const valid = {
    idempotencyKey: UUID_A,
    billId: UUID_B,
    method: 'UPI_STATIC',
    amountPaise: 12300,
    providerReference: '123456789012',
    note: 'GPay',
    expectedBillVersion: 1,
  };

  it('accepts a valid UPI payment', () => {
    expect(recordPaymentRequestSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a CASH payment without a reference', () => {
    const { providerReference: _pr, note: _n, ...cash } = valid;
    expect(recordPaymentRequestSchema.safeParse({ ...cash, method: 'CASH' }).success).toBe(true);
  });

  it('has NO cashTenderedPaise — change-giving is UI-only, unknown keys are stripped', () => {
    const parsed = recordPaymentRequestSchema.parse({ ...valid, cashTenderedPaise: 50000 });
    expect(parsed).not.toHaveProperty('cashTenderedPaise');
  });

  it('rejects unsupported methods (no cards / gateways in V1)', () => {
    expect(recordPaymentRequestSchema.safeParse({ ...valid, method: 'CARD' }).success).toBe(false);
    expect(paymentMethodSchema.options).toEqual(['CASH', 'UPI_STATIC']);
  });

  it('rejects zero, negative, fractional and unsafe amounts', () => {
    for (const amountPaise of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(recordPaymentRequestSchema.safeParse({ ...valid, amountPaise }).success).toBe(false);
    }
  });

  it('requires a UUID idempotency key and a bill version', () => {
    expect(recordPaymentRequestSchema.safeParse({ ...valid, idempotencyKey: 'abc' }).success).toBe(
      false,
    );
    const { expectedBillVersion: _v, ...noVersion } = valid;
    expect(recordPaymentRequestSchema.safeParse(noVersion).success).toBe(false);
  });
});

describe('payment status', () => {
  it('reserves PENDING / FAILED / REVERSED for the future gateway flow', () => {
    expect(paymentStatusSchema.options).toEqual(['PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED']);
  });
});
