import {
  BadRequestException,
  type ArgumentsHost,
  type HttpStatus as HttpStatusType,
} from '@nestjs/common';
import { errorEnvelopeSchema } from '@rewardbite/contracts';
import { GlobalExceptionFilter } from './global-exception.filter';

function createHost(): { host: ArgumentsHost; getStatus: () => number; getBody: () => unknown } {
  let status: number | undefined;
  let body: unknown;

  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    getStatus: () => status as HttpStatusType,
    getBody: () => body,
  };
}

describe('GlobalExceptionFilter', () => {
  it('produces a response that satisfies the shared ErrorEnvelope contract', () => {
    const filter = new GlobalExceptionFilter();
    const { host, getStatus, getBody } = createHost();

    filter.catch(new BadRequestException('qty must be positive'), host);

    expect(getStatus()).toBe(400);
    const body = getBody();
    const result = errorEnvelopeSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error.code).toBe('VALIDATION_FAILED');
      expect(result.data.error.retryable).toBe(false);
    }
  });

  it('maps an unrecognised error to a retryable INTERNAL envelope', () => {
    const filter = new GlobalExceptionFilter();
    const { host, getStatus, getBody } = createHost();

    filter.catch(new Error('unexpected'), host);

    expect(getStatus()).toBe(500);
    const result = errorEnvelopeSchema.safeParse(getBody());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error.code).toBe('INTERNAL');
      expect(result.data.error.retryable).toBe(true);
    }
  });
});
