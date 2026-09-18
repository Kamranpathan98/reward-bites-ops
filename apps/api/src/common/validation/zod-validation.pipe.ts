import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * "Zod validation pipe" in the request pipeline (architecture section 5).
 * Backend validation is authoritative; unknown keys are stripped by the
 * schema itself (Zod's default `.object()` behaviour). Validation
 * failures come back shaped for `ErrorEnvelope.error.details`
 * (architecture section 14: `[{path, code, message}]`).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      }));
      throw new BadRequestException({
        message: 'Request failed validation.',
        details,
      });
    }
    return result.data;
  }
}
