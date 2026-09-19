import { MAX_PAISE, MoneyRangeError, toPaise, toSignedPaise } from './paise';

describe('checked paise conversion', () => {
  it('converts BIGINT strings exactly up to MAX_SAFE_INTEGER', () => {
    expect(toPaise('0')).toBe(0);
    expect(toPaise('12345')).toBe(12345);
    expect(toPaise(String(MAX_PAISE))).toBe(MAX_PAISE);
    expect(toPaise(MAX_PAISE)).toBe(MAX_PAISE);
    expect(toPaise(123n)).toBe(123);
  });

  it('THROWS instead of silently rounding an unsafe BIGINT', () => {
    expect(() => toPaise(String(MAX_PAISE + 2))).toThrow(MoneyRangeError);
    expect(() => toPaise('9223372036854775807')).toThrow(MoneyRangeError); // BIGINT max
    expect(() => toPaise(BigInt(MAX_PAISE) + 1n)).toThrow(MoneyRangeError);
    expect(() => toPaise(MAX_PAISE + 1)).toThrow(MoneyRangeError); // unsafe number
  });

  it('rejects negatives for unsigned paise, fractions, and non-numeric input', () => {
    expect(() => toPaise('-1')).toThrow(MoneyRangeError);
    expect(() => toPaise(1.5)).toThrow(MoneyRangeError);
    expect(() => toPaise('12.50')).toThrow(MoneyRangeError);
    expect(() => toPaise('abc')).toThrow(MoneyRangeError);
  });

  it('allows signed values within range for rounding amounts', () => {
    expect(toSignedPaise('-49')).toBe(-49);
    expect(toSignedPaise('50')).toBe(50);
    expect(() => toSignedPaise(String(-MAX_PAISE - 2))).toThrow(MoneyRangeError);
  });
});
