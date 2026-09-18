import { describe, expect, it } from 'vitest';
import { parseApiError } from './parse-api-error';

describe('parseApiError', () => {
  it('parses a valid error envelope', () => {
    const payload = {
      error: {
        code: 'NOT_FOUND',
        message: 'This order no longer exists.',
        requestId: 'req_123',
        retryable: false,
      },
    };

    expect(parseApiError(payload)).toEqual(payload);
  });

  it('returns null for a payload that is not a valid envelope', () => {
    expect(parseApiError({ oops: true })).toBeNull();
    expect(parseApiError(null)).toBeNull();
    expect(parseApiError('a string')).toBeNull();
  });
});
