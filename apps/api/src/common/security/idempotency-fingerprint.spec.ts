import { canonicalJsonFingerprint } from './idempotency-fingerprint';

describe('canonicalJsonFingerprint', () => {
  it('produces the same fingerprint regardless of object key order', () => {
    const a = canonicalJsonFingerprint({ type: 'TAKEAWAY', lines: [{ itemId: '1', qty: 2 }] });
    const b = canonicalJsonFingerprint({ lines: [{ qty: 2, itemId: '1' }], type: 'TAKEAWAY' });
    expect(a).toBe(b);
  });

  it('produces a different fingerprint when array element order changes (order is meaningful)', () => {
    const a = canonicalJsonFingerprint({ lines: [{ itemId: '1' }, { itemId: '2' }] });
    const b = canonicalJsonFingerprint({ lines: [{ itemId: '2' }, { itemId: '1' }] });
    expect(a).not.toBe(b);
  });

  it('produces a different fingerprint when a value actually changes', () => {
    const a = canonicalJsonFingerprint({ qty: 1 });
    const b = canonicalJsonFingerprint({ qty: 2 });
    expect(a).not.toBe(b);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const body = { type: 'DINE_IN', tableId: 'abc', lines: [{ itemId: 'x', qty: 3 }] };
    expect(canonicalJsonFingerprint(body)).toBe(canonicalJsonFingerprint(body));
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    const fingerprint = canonicalJsonFingerprint({ a: 1 });
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
