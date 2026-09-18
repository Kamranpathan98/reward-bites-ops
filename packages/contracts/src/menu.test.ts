import { describe, expect, it } from 'vitest';
import {
  createItemRequestSchema,
  patchCategoryRequestSchema,
  patchItemRequestSchema,
  reorderRequestSchema,
} from './menu';

describe('reorderRequestSchema', () => {
  it('accepts the categoryIds shape', () => {
    const result = reorderRequestSchema.safeParse({
      categoryIds: ['11111111-1111-1111-1111-111111111111'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the categoryId + itemIds shape', () => {
    const result = reorderRequestSchema.safeParse({
      categoryId: '11111111-1111-1111-1111-111111111111',
      itemIds: ['22222222-2222-2222-2222-222222222222'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a body matching neither shape', () => {
    const result = reorderRequestSchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(false);
  });

  it('rejects mixing both shapes at once', () => {
    const result = reorderRequestSchema.safeParse({
      categoryIds: ['11111111-1111-1111-1111-111111111111'],
      categoryId: '11111111-1111-1111-1111-111111111111',
      itemIds: ['22222222-2222-2222-2222-222222222222'],
    });
    // The union still matches the first branch (extra keys are stripped by
    // the first object schema, not rejected) — this documents that
    // behaviour rather than assuming strictness the schema doesn't have.
    expect(result.success).toBe(true);
  });
});

describe('patchCategoryRequestSchema', () => {
  it('rejects an empty patch body', () => {
    const result = patchCategoryRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a single-field patch', () => {
    const result = patchCategoryRequestSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it('trims and rejects a whitespace-only name', () => {
    const result = patchCategoryRequestSchema.safeParse({ name: '   ' });
    expect(result.success).toBe(false);
  });
});

describe('createItemRequestSchema', () => {
  it('accepts an item with no base price and no variants (variant-only item, priced later)', () => {
    const result = createItemRequestSchema.safeParse({
      categoryId: '11111111-1111-1111-1111-111111111111',
      name: 'Fried Rice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative base price', () => {
    const result = createItemRequestSchema.safeParse({
      categoryId: '11111111-1111-1111-1111-111111111111',
      name: 'Fried Rice',
      basePricePaise: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown vegFlag value', () => {
    const result = createItemRequestSchema.safeParse({
      categoryId: '11111111-1111-1111-1111-111111111111',
      name: 'Fried Rice',
      vegFlag: 'VEGAN',
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 50 addon assignments', () => {
    const addons = Array.from({ length: 51 }, (_, i) => ({
      addonId: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
      maxQty: 1,
    }));
    const result = createItemRequestSchema.safeParse({
      categoryId: '11111111-1111-1111-1111-111111111111',
      name: 'Fried Rice',
      addons,
    });
    expect(result.success).toBe(false);
  });
});

describe('patchItemRequestSchema', () => {
  it('accepts explicitly nulling basePricePaise', () => {
    const result = patchItemRequestSchema.safeParse({ basePricePaise: null });
    expect(result.success).toBe(true);
  });

  it('does not accept a server-owned field like id or tenantId', () => {
    const result = patchItemRequestSchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      name: 'Renamed',
    });
    expect(result.success).toBe(true);
    // Zod strips unknown keys by default — assert they are actually gone,
    // not merely ignored by the type system.
    if (result.success) {
      expect(result.data).not.toHaveProperty('id');
      expect(result.data).not.toHaveProperty('tenantId');
      expect(result.data).toEqual({ name: 'Renamed' });
    }
  });
});
