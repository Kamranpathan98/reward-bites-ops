import { HttpException } from '@nestjs/common';

/**
 * The `DomainError` subclass mechanism `error-code.util.ts` has anticipated
 * since Sprint 1 ("until each domain module starts throwing its own
 * specific DomainError subclasses ... e.g. ITEM_UNAVAILABLE,
 * ORDER_ALREADY_BILLED"). Gate 6 (orders) is the first module that needs a
 * code more specific than the generic HTTP-status mapping — e.g. 409 is
 * both `VERSION_CONFLICT` (a stale `expectedVersion`) and
 * `IDEMPOTENT_MISMATCH` (a reused idempotency key with a different body),
 * and callers need to tell them apart.
 *
 * `GlobalExceptionFilter` prefers this exception's own `code` over the
 * generic status-derived one; every other existing exception type
 * (`NotFoundException`, `ConflictException`, ...) is unaffected, since they
 * never carry a `code` in their response body.
 */
export class DomainError extends HttpException {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super({ message, code, ...(details ? { details } : {}) }, status);
  }
}
