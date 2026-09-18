import type { Request, Response } from 'express';
import { ConfigService } from '../../common/config/config.service';

export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Architecture section 7: refresh token in an `HttpOnly; Secure;
 * SameSite=Strict; Path=/auth` cookie. `secure` is relaxed in development
 * only, since local HTTP dev servers can't set a Secure cookie the
 * browser will actually send back.
 */
export function setRefreshCookie(
  response: Response,
  config: ConfigService,
  rawToken: string,
): void {
  response.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: config.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/auth',
    maxAge: config.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(response: Response, config: ConfigService): void {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/auth',
  });
}

export function readRefreshCookie(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}
