import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from './error-envelope';

describe('errorEnvelopeSchema', () => {
  it('accepts a minimal valid envelope', () => {
    const result = errorEnvelopeSchema.safeParse({
      error: {
        code: 'NOT_FOUND',
        message: 'This order no longer exists.',
        requestId: 'req_123',
        retryable: false,
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts field-error details for a validation failure', () => {
    const result = errorEnvelopeSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request failed validation.',
        details: [{ path: 'qty', code: 'too_small', message: 'qty must be greater than 0' }],
        requestId: 'req_456',
        retryable: false,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an envelope missing a required field', () => {
    const result = errorEnvelopeSchema.safeParse({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong.',
        retryable: true,
        // requestId missing
      },
    });

    expect(result.success).toBe(false);
  });
});
