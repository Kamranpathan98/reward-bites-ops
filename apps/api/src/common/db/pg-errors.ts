/**
 * Postgres error code 23505 = unique_violation. Used by every
 * insert-and-let-the-constraint-arbitrate flow in this codebase (session
 * open racing the partial unique index, idempotency-key inserts) instead of
 * a check-then-insert, which would itself race under concurrency.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false;
  const pgErr = err as Error & { code?: string; constraint?: string };
  if (pgErr.code !== '23505') return false;
  return constraint === undefined || pgErr.constraint === constraint;
}
