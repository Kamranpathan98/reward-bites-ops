import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service';

/**
 * Access-token claims, exactly as specified in architecture section 7:
 * `sub` (user id), `tid` (tenant id), `mid` (membership id), `rv` (role/
 * security version), `aud: 'tenant'`, `jti`. `tid`/`mid` are absent on an
 * "unbound" token — issued when login found zero or multiple memberships,
 * good only for `POST /auth/select-tenant`.
 */
export interface AccessTokenClaims {
  sub: string;
  tid?: string;
  mid?: string;
  rv: number;
  aud: 'tenant';
  jti: string;
}

export type MintAccessTokenInput = Pick<AccessTokenClaims, 'sub' | 'rv'> &
  Partial<Pick<AccessTokenClaims, 'tid' | 'mid'>>;

/** The only audience this service ever mints or accepts (architecture section 7: `aud: 'tenant'`). */
export const TENANT_TOKEN_AUDIENCE = 'tenant' as const;

/**
 * Thin wrapper around @nestjs/jwt fixing algorithm (HS256), secret, and TTL
 * from env, and the claim shape above. No sensitive operational data goes
 * in the token (architecture section 7).
 */
@Injectable()
export class AppJwtService {
  constructor(
    private readonly jwt: NestJwtService,
    private readonly config: ConfigService,
  ) {}

  mintAccessToken(input: MintAccessTokenInput): string {
    const claims: AccessTokenClaims = {
      sub: input.sub,
      rv: input.rv,
      aud: TENANT_TOKEN_AUDIENCE,
      jti: randomUUID(),
      ...(input.tid ? { tid: input.tid } : {}),
      ...(input.mid ? { mid: input.mid } : {}),
    };
    const options: JwtSignOptions = {
      secret: this.config.env.JWT_SECRET,
      expiresIn: this.config.env.JWT_ACCESS_TTL as NonNullable<JwtSignOptions['expiresIn']>,
      algorithm: 'HS256',
    };
    return this.jwt.sign(claims, options);
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    // Gate 2 red-team finding: `aud` was embedded at mint time but never
    // checked at verify time, so any token signed with this secret would
    // pass regardless of its `aud` value. `audience` here makes
    // jsonwebtoken reject anything whose `aud` isn't exactly 'tenant' —
    // including a token with no `aud` claim at all.
    return this.jwt.verify<AccessTokenClaims>(token, {
      secret: this.config.env.JWT_SECRET,
      algorithms: ['HS256'],
      audience: TENANT_TOKEN_AUDIENCE,
    });
  }
}
