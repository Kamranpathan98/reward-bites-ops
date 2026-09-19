import { ApiError } from '@/lib/api-client';

/** Paise -> "₹12.50" (signed, so a rounding line can show "-₹0.49"). */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${(Math.abs(paise) / 100).toFixed(2)}`;
}

/** Presentation only: the database value stays a BIGINT counter. */
export function formatBillNumber(billNumber: number | null): string {
  return billNumber === null ? 'Draft bill' : `Bill ${String(billNumber).padStart(4, '0')}`;
}

/** "12.5" -> 1250 paise; rejects negatives, more than 2 decimals and non-numbers. */
export function rupeesToPaise(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const paise = whole * 100 + fraction;
  return Number.isSafeInteger(paise) ? paise : null;
}

/** "12.34" (%) -> 1234 basis points. Same parsing rules as rupeesToPaise. */
export function percentToBasisPoints(input: string): number | null {
  return rupeesToPaise(input);
}

export function describeBillError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Codes that mean "the screen is stale": refetch instead of just showing an error. */
export function isStaleBillError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ['VERSION_CONFLICT', 'BILL_TOTALS_CHANGED', 'BILL_NOT_DRAFT', 'BILL_NOT_PAYABLE'].includes(
      error.code,
    )
  );
}
