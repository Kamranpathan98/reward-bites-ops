import { describe, expect, it } from 'vitest';
import {
  cancelOrderRequestSchema,
  createOrderRequestSchema,
  listOrdersQuerySchema,
  patchOrderLinesRequestSchema,
} from './orders';

describe('createOrderRequestSchema', () => {
  it('accepts a minimal valid DINE_IN order', () => {
    const result = createOrderRequestSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      type: 'DINE_IN',
      tableId: '22222222-2222-2222-2222-222222222222',
      lines: [{ itemId: '33333333-3333-3333-3333-333333333333', qty: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an order with zero lines', () => {
    const result = createOrderRequestSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      type: 'TAKEAWAY',
      lines: [],
    });
    expect(result.success).toBe(false);
  });

  it('strips server-owned fields (status, subtotalPaise, tenantId) — never honored even if sent', () => {
    const result = createOrderRequestSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      type: 'TAKEAWAY',
      lines: [{ itemId: '33333333-3333-3333-3333-333333333333', qty: 1 }],
      status: 'COMPLETED',
      subtotalPaise: 1,
      tenantId: 'not-a-real-tenant',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('status');
      expect(result.data).not.toHaveProperty('subtotalPaise');
      expect(result.data).not.toHaveProperty('tenantId');
    }
  });

  it('rejects a non-UUID idempotencyKey', () => {
    const result = createOrderRequestSchema.safeParse({
      idempotencyKey: 'not-a-uuid',
      type: 'TAKEAWAY',
      lines: [{ itemId: '33333333-3333-3333-3333-333333333333', qty: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a zero or negative qty', () => {
    const zero = createOrderRequestSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      type: 'TAKEAWAY',
      lines: [{ itemId: '33333333-3333-3333-3333-333333333333', qty: 0 }],
    });
    expect(zero.success).toBe(false);

    const negative = createOrderRequestSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      type: 'TAKEAWAY',
      lines: [{ itemId: '33333333-3333-3333-3333-333333333333', qty: -1 }],
    });
    expect(negative.success).toBe(false);
  });
});

describe('patchOrderLinesRequestSchema', () => {
  it('rejects a body with no add/update/remove', () => {
    const result = patchOrderLinesRequestSchema.safeParse({ expectedVersion: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts a remove-only body', () => {
    const result = patchOrderLinesRequestSchema.safeParse({
      expectedVersion: 0,
      remove: ['11111111-1111-1111-1111-111111111111'],
    });
    expect(result.success).toBe(true);
  });
});

describe('cancelOrderRequestSchema', () => {
  it('requires a non-empty reason', () => {
    const result = cancelOrderRequestSchema.safeParse({ expectedVersion: 0, reason: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a real reason', () => {
    const result = cancelOrderRequestSchema.safeParse({
      expectedVersion: 0,
      reason: 'Customer left',
    });
    expect(result.success).toBe(true);
  });
});

describe('listOrdersQuerySchema', () => {
  it('normalizes a single repeated-param status string into an array', () => {
    const result = listOrdersQuerySchema.safeParse({ status: 'NEW' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toEqual(['NEW']);
  });

  it('accepts an already-array status (two or more repeated params)', () => {
    const result = listOrdersQuerySchema.safeParse({ status: ['NEW', 'ACCEPTED'] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toEqual(['NEW', 'ACCEPTED']);
  });

  it('rejects an invalid status value', () => {
    const result = listOrdersQuerySchema.safeParse({ status: 'BOGUS' });
    expect(result.success).toBe(false);
  });

  it('defaults limit to 20 and coerces a string query value to a number', () => {
    const result = listOrdersQuerySchema.safeParse({ limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);

    const defaulted = listOrdersQuerySchema.safeParse({});
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data.limit).toBe(20);
  });
});
