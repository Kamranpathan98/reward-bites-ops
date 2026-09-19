/**
 * Checked BIGINT-paise <-> JS number conversion (Gate 8 money safety).
 *
 * PostgreSQL BIGINT columns come back from `pg` as strings (there is no type
 * parser), and aggregates (`SUM`, `count`) come back as numeric/bigint strings.
 * The repository convention is to hand `number` to the contracts, which is only
 * lossless up to Number.MAX_SAFE_INTEGER (~90 trillion rupees). Every Gate 8
 * money column is CHECKed to that bound in the database; this helper is the
 * matching application-side guard: it THROWS instead of silently rounding a
 * value that cannot be represented exactly.
 */
export const MAX_PAISE = Number.MAX_SAFE_INTEGER;
const MAX_PAISE_BIG = BigInt(MAX_PAISE);

export class MoneyRangeError extends Error {
  constructor(what: string, value: unknown) {
    super(`${what} is outside the safe paise range: ${String(value)}`);
    this.name = 'MoneyRangeError';
  }
}

function toBigInt(value: string | number | bigint, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new MoneyRangeError(what, value);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new MoneyRangeError(what, value);
  return BigInt(value);
}

/** Non-negative paise: 0 <= value <= MAX_SAFE_INTEGER. */
export function toPaise(value: string | number | bigint, what = 'amount'): number {
  const big = toBigInt(value, what);
  if (big < 0n || big > MAX_PAISE_BIG) throw new MoneyRangeError(what, value);
  return Number(big);
}

/** Signed paise (e.g. rounding): |value| <= MAX_SAFE_INTEGER. */
export function toSignedPaise(value: string | number | bigint, what = 'amount'): number {
  const big = toBigInt(value, what);
  if (big < -MAX_PAISE_BIG || big > MAX_PAISE_BIG) throw new MoneyRangeError(what, value);
  return Number(big);
}
