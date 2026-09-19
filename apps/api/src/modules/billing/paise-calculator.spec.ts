import { DomainError } from '../../common/errors/domain-error';
import { MAX_PAISE, MoneyRangeError } from '../../common/money/paise';
import {
  computeBillTotals,
  computeSubtotalPaise,
  reapplyDiscount,
  resolveDiscount,
} from './paise-calculator';

function expectCapError(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected DISCOUNT_EXCEEDS_CAP');
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).getResponse()).toMatchObject({ code: 'DISCOUNT_EXCEEDS_CAP' });
  }
}

describe('computeSubtotalPaise', () => {
  it('sums line totals exactly', () => {
    expect(computeSubtotalPaise([48000, 48000, 7000])).toBe(103000);
    expect(computeSubtotalPaise([])).toBe(0);
  });

  it('throws on an unsafe total instead of losing precision', () => {
    expect(() => computeSubtotalPaise([MAX_PAISE, 1])).toThrow(MoneyRangeError);
  });
});

describe('resolveDiscount — percent', () => {
  it('rounds half-up to the paise', () => {
    // 10.5% of 12345 = 1296.225 -> 1296; 10% of 12345 = 1234.5 -> 1235 (half-up)
    expect(resolveDiscount(12345, { kind: 'PERCENT', value: 1050 }, 5000).amountPaise).toBe(1296);
    expect(resolveDiscount(12345, { kind: 'PERCENT', value: 1000 }, 5000).amountPaise).toBe(1235);
  });

  it('records basis points and a readable label', () => {
    const d = resolveDiscount(10000, { kind: 'PERCENT', value: 1050 }, 5000);
    expect(d).toMatchObject({
      adjustmentKind: 'DISCOUNT_PERCENT',
      basisBp: 1050,
      label: 'Discount 10.5%',
    });
  });

  it('allows exactly the cap and rejects one basis point above it', () => {
    expect(resolveDiscount(10000, { kind: 'PERCENT', value: 5000 }, 5000).amountPaise).toBe(5000);
    expectCapError(() => resolveDiscount(10000, { kind: 'PERCENT', value: 5001 }, 5000));
  });

  it('cannot overflow: subtotal * bp is computed in BigInt', () => {
    // 9e15 * 5000 ~ 4.5e19 — far beyond a double's exact range.
    const subtotal = 9_000_000_000_000_000;
    const d = resolveDiscount(subtotal, { kind: 'PERCENT', value: 5000 }, 5000);
    expect(d.amountPaise).toBe(4_500_000_000_000_000);
  });
});

describe('resolveDiscount — fixed', () => {
  it('accepts a fixed discount within the cap', () => {
    const d = resolveDiscount(10000, { kind: 'FIXED', value: 5000 }, 5000);
    expect(d).toMatchObject({ adjustmentKind: 'DISCOUNT_FIXED', basisBp: null, amountPaise: 5000 });
  });

  it('rejects a fixed discount above the cap, exactly at the paise boundary', () => {
    expectCapError(() => resolveDiscount(10000, { kind: 'FIXED', value: 5001 }, 5000));
  });

  it('never allows a fixed discount above the subtotal, even with a 100% cap', () => {
    expectCapError(() => resolveDiscount(10000, { kind: 'FIXED', value: 10001 }, 10000));
  });

  it('clamps a malformed cap into 0..10000', () => {
    expectCapError(() => resolveDiscount(10000, { kind: 'PERCENT', value: 1 }, -5));
    expect(resolveDiscount(10000, { kind: 'PERCENT', value: 10000 }, 99999).amountPaise).toBe(
      10000,
    );
  });
});

describe('reapplyDiscount', () => {
  it('re-derives a percent discount from its basis points on the new subtotal', () => {
    const stored = { kind: 'DISCOUNT_PERCENT' as const, basisBp: 1000, amountPaise: 1000 };
    expect(reapplyDiscount(20000, stored, 5000).amountPaise).toBe(2000);
  });

  it('keeps a fixed discount but re-checks the cap against the new subtotal', () => {
    const stored = { kind: 'DISCOUNT_FIXED' as const, basisBp: null, amountPaise: 6000 };
    expect(reapplyDiscount(20000, stored, 5000).amountPaise).toBe(6000);
    expectCapError(() => reapplyDiscount(10000, stored, 5000));
  });
});

describe('computeBillTotals — round to the rupee (half-up)', () => {
  it.each([
    // [subtotal, discount, expected rounding, expected grand total]
    [12300, 0, 0, 12300],
    [12349, 0, -49, 12300], // r = 49 rounds down
    [12350, 0, 50, 12400], // r = 50 rounds up (half-up)
    [12399, 0, 1, 12400], // r = 99 rounds up
    [12301, 0, -1, 12300],
    [12345, 1235, -10, 11100], // P = 11110, r = 10
  ])('subtotal %i discount %i -> rounding %i, grand %i', (subtotal, discount, rounding, grand) => {
    expect(computeBillTotals(subtotal, discount, true)).toEqual({
      subtotalPaise: subtotal,
      discountPaise: discount,
      roundingPaise: rounding,
      grandTotalPaise: grand,
    });
  });

  it('keeps rounding within -49..+50 for every remainder', () => {
    for (let r = 0; r < 100; r += 1) {
      const t = computeBillTotals(10_000 + r, 0, true);
      expect(t.roundingPaise).toBeGreaterThanOrEqual(-49);
      expect(t.roundingPaise).toBeLessThanOrEqual(50);
      expect(t.grandTotalPaise % 100).toBe(0);
    }
  });

  it('does not round when round_to_rupee is off', () => {
    expect(computeBillTotals(12349, 0, false)).toMatchObject({
      roundingPaise: 0,
      grandTotalPaise: 12349,
    });
  });

  it('satisfies the database formula grand = subtotal - discount + rounding', () => {
    const t = computeBillTotals(98765, 4321, true);
    expect(t.grandTotalPaise).toBe(t.subtotalPaise - t.discountPaise + t.roundingPaise);
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() => computeBillTotals(1000, 1001, true)).toThrow(DomainError);
  });
});
