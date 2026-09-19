import { DomainError } from '../../common/errors/domain-error';
import { toPaise, toSignedPaise } from '../../common/money/paise';

/**
 * `computeBillTotals` (architecture section 9): the one pure function that
 * derives every bill total. All intermediate arithmetic is BigInt, so
 * `subtotal * basisPoints` can never overflow a JS number; results go back
 * through the checked converters.
 *
 *   discount (percent)        = floor((subtotal * bp + 5000) / 10000)    (half-up to the paise)
 *   P                         = subtotal - discount                       (tax/service/delivery are 0 in V1)
 *   rounding (round_to_rupee) = r < 50 ? -r : 100 - r,  r = P mod 100     (half-up to the rupee, -49..+50)
 *   grand_total               = P + rounding
 *
 * The database re-checks the arithmetic (bill_grand_total_formula CHECK); this
 * module decides the numbers.
 */

export type DiscountRequest =
  | { kind: 'PERCENT'; value: number; reason?: string | undefined }
  | { kind: 'FIXED'; value: number; reason?: string | undefined };

export interface ResolvedDiscount {
  adjustmentKind: 'DISCOUNT_PERCENT' | 'DISCOUNT_FIXED';
  basisBp: number | null;
  amountPaise: number;
  label: string;
}

export interface BillTotals {
  subtotalPaise: number;
  discountPaise: number;
  roundingPaise: number;
  grandTotalPaise: number;
}

const BP_DENOMINATOR = 10_000n;

function formatPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}

export function computeSubtotalPaise(lineTotals: readonly number[]): number {
  let sum = 0n;
  for (const total of lineTotals) sum += BigInt(toPaise(total, 'line total'));
  return toPaise(sum, 'subtotal');
}

/**
 * Turns a discount request into the amount to store, enforcing the tenant cap
 * `max_discount_bp` (default 5000 = 50%). Percent discounts compare the rate to
 * the cap; fixed discounts compare `discount * 10000 <= subtotal * cap` exactly
 * (BigInt), which also guarantees a fixed discount never exceeds the subtotal.
 */
export function resolveDiscount(
  subtotalPaise: number,
  request: DiscountRequest,
  maxDiscountBp: number,
): ResolvedDiscount {
  const cap = Math.max(0, Math.min(10_000, maxDiscountBp));
  const subtotal = BigInt(subtotalPaise);

  if (request.kind === 'PERCENT') {
    if (request.value > cap) {
      throw new DomainError(
        422,
        'DISCOUNT_EXCEEDS_CAP',
        `A discount of ${formatPercent(request.value)} exceeds the maximum allowed ${formatPercent(cap)}.`,
        { maxDiscountBp: cap },
      );
    }
    const amount = (subtotal * BigInt(request.value) + BP_DENOMINATOR / 2n) / BP_DENOMINATOR;
    return {
      adjustmentKind: 'DISCOUNT_PERCENT',
      basisBp: request.value,
      amountPaise: toPaise(amount, 'discount'),
      label: `Discount ${formatPercent(request.value)}`,
    };
  }

  const fixed = BigInt(request.value);
  if (fixed * BP_DENOMINATOR > subtotal * BigInt(cap)) {
    throw new DomainError(
      422,
      'DISCOUNT_EXCEEDS_CAP',
      'This discount exceeds the maximum allowed for this bill.',
      { maxDiscountBp: cap },
    );
  }
  return {
    adjustmentKind: 'DISCOUNT_FIXED',
    basisBp: null,
    amountPaise: toPaise(fixed, 'discount'),
    label: 'Discount',
  };
}

/**
 * Recomputes a stored discount against a (possibly changed) subtotal: a percent
 * discount is re-derived from its basis points, a fixed one is re-checked
 * against the cap. Used at finalize, when the subtotal is rebuilt from the
 * current order lines.
 */
export function reapplyDiscount(
  subtotalPaise: number,
  stored: {
    kind: 'DISCOUNT_PERCENT' | 'DISCOUNT_FIXED';
    basisBp: number | null;
    amountPaise: number;
  },
  maxDiscountBp: number,
): ResolvedDiscount {
  if (stored.kind === 'DISCOUNT_PERCENT') {
    return resolveDiscount(
      subtotalPaise,
      { kind: 'PERCENT', value: stored.basisBp as number },
      maxDiscountBp,
    );
  }
  return resolveDiscount(
    subtotalPaise,
    { kind: 'FIXED', value: stored.amountPaise },
    maxDiscountBp,
  );
}

export function computeBillTotals(
  subtotalPaise: number,
  discountPaise: number,
  roundToRupee: boolean,
): BillTotals {
  const subtotal = BigInt(subtotalPaise);
  const discount = BigInt(discountPaise);
  if (discount > subtotal) {
    throw new DomainError(422, 'VALIDATION_FAILED', 'The discount cannot exceed the subtotal.');
  }
  const preRound = subtotal - discount;
  let rounding = 0n;
  if (roundToRupee) {
    const remainder = preRound % 100n;
    rounding = remainder < 50n ? -remainder : 100n - remainder;
  }
  return {
    subtotalPaise,
    discountPaise,
    roundingPaise: toSignedPaise(rounding, 'rounding'),
    grandTotalPaise: toPaise(preRound + rounding, 'grand total'),
  };
}
