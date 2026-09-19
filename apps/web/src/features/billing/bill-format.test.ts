import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  describeBillError,
  formatBillNumber,
  formatPaise,
  isStaleBillError,
  percentToBasisPoints,
  rupeesToPaise,
} from './bill-format';

const apiError = (code: string, message = 'msg'): ApiError =>
  new ApiError({ error: { code, message, requestId: 'r', retryable: false } }, 409);

describe('bill-format', () => {
  it('formats paise with a sign so rounding lines read correctly', () => {
    expect(formatPaise(12345)).toBe('₹123.45');
    expect(formatPaise(0)).toBe('₹0.00');
    expect(formatPaise(-49)).toBe('-₹0.49');
  });

  it('formats a bill number and labels an unnumbered draft', () => {
    expect(formatBillNumber(7)).toBe('Bill 0007');
    expect(formatBillNumber(12345)).toBe('Bill 12345');
    expect(formatBillNumber(null)).toBe('Draft bill');
  });

  it('parses rupees to paise and rejects malformed input', () => {
    expect(rupeesToPaise('12')).toBe(1200);
    expect(rupeesToPaise('12.5')).toBe(1250);
    expect(rupeesToPaise(' 0.07 ')).toBe(7);
    for (const bad of ['', '-1', '1.234', 'abc', '1,5', '.5', '1e3']) {
      expect(rupeesToPaise(bad)).toBeNull();
    }
    expect(rupeesToPaise('99999999999999999999')).toBeNull();
  });

  it('parses percent to basis points', () => {
    expect(percentToBasisPoints('10')).toBe(1000);
    expect(percentToBasisPoints('12.34')).toBe(1234);
    expect(percentToBasisPoints('x')).toBeNull();
  });

  it('flags only stale-screen error codes for a refresh', () => {
    expect(isStaleBillError(apiError('VERSION_CONFLICT'))).toBe(true);
    expect(isStaleBillError(apiError('BILL_TOTALS_CHANGED'))).toBe(true);
    expect(isStaleBillError(apiError('OVERPAYMENT'))).toBe(false);
    expect(isStaleBillError(new Error('x'))).toBe(false);
  });

  it('uses the server message for API errors and a generic one otherwise', () => {
    expect(describeBillError(apiError('X', 'Order already billed.'))).toBe('Order already billed.');
    expect(describeBillError(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
