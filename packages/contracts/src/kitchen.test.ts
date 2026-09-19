import { describe, expect, it } from 'vitest';
import {
  kitchenOrderTicketViewSchema,
  kitchenOrdersQuerySchema,
  kitchenOrdersResponseSchema,
} from './kitchen';

describe('Kitchen contracts', () => {
  const sampleTicket = {
    id: '11111111-1111-1111-1111-111111111111',
    orderNumber: '#0042',
    tableName: 'Table 04',
    customerName: 'Rahul',
    source: 'COUNTER' as const,
    type: 'DINE_IN' as const,
    status: 'ACCEPTED' as const,
    version: 1,
    placedAt: '2026-09-19T05:30:00.000Z',
    acceptedAt: '2026-09-19T05:31:00.000Z',
    readyAt: null,
    notes: 'Extra spicy',
    isEdited: false,
    editReason: null,
    lines: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        itemName: 'Butter Chicken',
        variantName: 'Half',
        qty: 2,
        notes: 'Mild gravy',
        status: 'ACTIVE' as const,
        addons: [
          {
            addonId: '33333333-3333-3333-3333-333333333333',
            nameSnapshot: 'Extra Butter',
            qty: 1,
          },
        ],
      },
    ],
  };

  it('validates a well-formed kitchen ticket', () => {
    const result = kitchenOrderTicketViewSchema.safeParse(sampleTicket);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid kitchen status (e.g. COMPLETED or CANCELLED)', () => {
    const completedTicket = { ...sampleTicket, status: 'COMPLETED' };
    const result = kitchenOrderTicketViewSchema.safeParse(completedTicket);
    expect(result.success).toBe(false);

    const cancelledTicket = { ...sampleTicket, status: 'CANCELLED' };
    expect(kitchenOrderTicketViewSchema.safeParse(cancelledTicket).success).toBe(false);
  });

  it('validates kitchenOrdersResponseSchema envelope', () => {
    const result = kitchenOrdersResponseSchema.safeParse({
      data: [sampleTicket],
      meta: { serverTime: '2026-09-19T05:35:00.000Z' },
    });
    expect(result.success).toBe(true);
  });

  it('normalizes single status vs array in kitchenOrdersQuerySchema', () => {
    const single = kitchenOrdersQuerySchema.parse({ status: 'PREPARING' });
    expect(single.status).toEqual(['PREPARING']);

    const array = kitchenOrdersQuerySchema.parse({ status: ['ACCEPTED', 'PREPARING'] });
    expect(array.status).toEqual(['ACCEPTED', 'PREPARING']);

    const empty = kitchenOrdersQuerySchema.parse({});
    expect(empty.status).toBeUndefined();
  });
});
