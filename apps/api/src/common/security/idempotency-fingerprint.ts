import { createHash } from 'node:crypto';

/**
 * "SHA-256 of the canonical (key-sorted) JSON request body" (architecture
 * section 12 / task instruction) — the fingerprint stored alongside every
 * idempotency key. Object keys are sorted recursively so semantically
 * identical bodies fingerprint identically regardless of client key order;
 * array element order is preserved (it's meaningful — e.g. `lines[]`).
 *
 * The caller passes the request body with the idempotency key itself
 * already stripped out (the key is not part of what's being fingerprinted
 * — it's the lookup key, the fingerprint is what proves the *rest* of the
 * body hasn't changed on replay).
 */
export function canonicalJsonFingerprint(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
