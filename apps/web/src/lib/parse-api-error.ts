import { errorEnvelopeSchema, type ErrorEnvelope } from '@rewardbite/contracts';

/**
 * Parses a fetch response body against the shared `ErrorEnvelope` contract.
 * Returns `null` if the payload isn't a valid envelope, so callers can fall
 * back to a generic error rather than trusting an unshaped body.
 */
export function parseApiError(payload: unknown): ErrorEnvelope | null {
  const result = errorEnvelopeSchema.safeParse(payload);
  return result.success ? result.data : null;
}
