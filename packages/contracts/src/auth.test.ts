import { describe, expect, it } from 'vitest';
import { signupRequestSchema } from './auth';

function validSignup(overrides: Record<string, unknown> = {}) {
  return {
    tenantName: 'My Restaurant',
    ownerName: 'Kamran',
    email: 'owner@example.com',
    password: 'a-real-owner-password-123',
    passwordConfirmation: 'a-real-owner-password-123',
    ...overrides,
  };
}

describe('signupRequestSchema', () => {
  it('accepts a normal, valid signup', () => {
    const result = signupRequestSchema.safeParse(validSignup());
    expect(result.success).toBe(true);
  });

  it('rejects a whitespace-only tenantName (red-team review finding)', () => {
    const result = signupRequestSchema.safeParse(validSignup({ tenantName: '   ' }));
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only ownerName (red-team review finding)', () => {
    const result = signupRequestSchema.safeParse(validSignup({ ownerName: '   ' }));
    expect(result.success).toBe(false);
  });

  it('still rejects an empty-string tenantName', () => {
    const result = signupRequestSchema.safeParse(validSignup({ tenantName: '' }));
    expect(result.success).toBe(false);
  });

  it('trims leading/trailing whitespace from tenantName and ownerName', () => {
    const result = signupRequestSchema.safeParse(
      validSignup({ tenantName: '  My Restaurant  ', ownerName: '  Kamran  ' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tenantName).toBe('My Restaurant');
      expect(result.data.ownerName).toBe('Kamran');
    }
  });

  it('rejects mismatched password confirmation (unrelated rule, unchanged)', () => {
    const result = signupRequestSchema.safeParse(
      validSignup({ passwordConfirmation: 'does-not-match' }),
    );
    expect(result.success).toBe(false);
  });

  it('still enforces the max(120) length on the trimmed value', () => {
    const result = signupRequestSchema.safeParse(validSignup({ tenantName: 'A'.repeat(121) }));
    expect(result.success).toBe(false);
  });
});
