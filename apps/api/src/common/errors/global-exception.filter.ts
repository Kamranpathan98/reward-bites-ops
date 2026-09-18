import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { errorEnvelopeSchema, fieldErrorSchema, type ErrorEnvelope } from '@rewardbite/contracts';
import { httpStatusToErrorCode } from './error-code.util';

/**
 * Every error response is shaped by the shared `ErrorEnvelope` contract
 * (architecture section 14): `{ error: { code, message, details?,
 * requestId, retryable } }`. This is the proof-of-wiring endpoint for that
 * contract on the backend — `packages/contracts` is not just imported, it
 * validates every error this API sends before it goes out.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = randomUUID();
    const message = this.extractMessage(exception, status);
    const details = this.extractDetails(exception);

    const envelope: ErrorEnvelope = {
      error: {
        code: this.extractDomainCode(exception) ?? httpStatusToErrorCode(status),
        message,
        requestId,
        retryable: status >= 500,
        ...(details ? { details } : {}),
      },
    };

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // Validate our own output against the shared contract before sending it.
    const parsed = errorEnvelopeSchema.parse(envelope);
    response.status(status).json(parsed);
  }

  private extractMessage(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') return response;
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const { message } = response as { message: unknown };
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.join(', ');
      }
      return exception.message;
    }
    return status >= 500 ? 'Something went wrong.' : 'Request could not be completed.';
  }

  /** A `DomainError`'s own `code` (e.g. `ITEM_UNAVAILABLE`), when present — see domain-error.ts. */
  private extractDomainCode(exception: unknown): string | undefined {
    if (!(exception instanceof HttpException)) return undefined;
    const response = exception.getResponse();
    if (typeof response !== 'object' || response === null || !('code' in response))
      return undefined;
    const { code } = response as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }

  private extractDetails(exception: unknown): ErrorEnvelope['error']['details'] | undefined {
    if (!(exception instanceof HttpException)) return undefined;
    const response = exception.getResponse();
    if (typeof response !== 'object' || response === null || !('details' in response)) {
      return undefined;
    }
    const candidate = (response as { details: unknown }).details;
    const parsed = fieldErrorSchema.array().safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  }
}
