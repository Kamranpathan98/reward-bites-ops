import { HttpStatus } from '@nestjs/common';

/**
 * Generic HTTP-status → error-code mapping used until each domain module
 * starts throwing its own specific `DomainError` subclasses (architecture
 * section 14 table, e.g. `ITEM_UNAVAILABLE`, `ORDER_ALREADY_BILLED`). No
 * business modules exist yet in Sprint 1, so this only covers the generic
 * classes.
 */
const STATUS_TO_CODE: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'TOKEN_INVALID',
  [HttpStatus.FORBIDDEN]: 'PERMISSION_DENIED',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'VERSION_CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'BUSINESS_RULE_VIOLATION',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'DB_UNAVAILABLE',
};

export function httpStatusToErrorCode(status: number): string {
  return STATUS_TO_CODE[status] ?? 'INTERNAL';
}
