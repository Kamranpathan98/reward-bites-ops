import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ email: z.string().email(), qty: z.number().positive() });
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value for valid input', () => {
    const result = pipe.transform({ email: 'a@b.com', qty: 2 });
    expect(result).toEqual({ email: 'a@b.com', qty: 2 });
  });

  it('strips unknown keys', () => {
    const result = pipe.transform({ email: 'a@b.com', qty: 2, extra: 'nope' });
    expect(result).toEqual({ email: 'a@b.com', qty: 2 });
  });

  it('throws BadRequestException with field-error details on invalid input', () => {
    try {
      pipe.transform({ email: 'not-an-email', qty: -1 });
      fail('expected transform to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as { details: unknown[] };
      expect(Array.isArray(response.details)).toBe(true);
      expect(response.details.length).toBeGreaterThanOrEqual(2);
      for (const detail of response.details) {
        expect(detail).toEqual(
          expect.objectContaining({
            path: expect.any(String),
            code: expect.any(String),
            message: expect.any(String),
          }),
        );
      }
    }
  });
});
