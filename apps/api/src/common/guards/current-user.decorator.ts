import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './request-context';

/**
 * `@CurrentUser() user: AuthenticatedUser` — reads what `AuthGuard`
 * attached to the request. Throws if used on a route without `AuthGuard`,
 * which is a programming error, not a runtime auth failure.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.authUser) {
      throw new Error('@CurrentUser() used on a route without AuthGuard');
    }
    return request.authUser;
  },
);
