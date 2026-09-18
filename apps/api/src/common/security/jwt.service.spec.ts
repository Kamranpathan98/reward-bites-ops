import { JwtService as NestJwtService } from '@nestjs/jwt';
import type { ConfigService } from '../config/config.service';
import { AppJwtService, TENANT_TOKEN_AUDIENCE } from './jwt.service';

function makeService(overrides?: { ttl?: string }): AppJwtService {
  const fakeConfig = {
    env: {
      JWT_SECRET: 'a-test-secret-that-is-at-least-32-characters-long',
      JWT_ACCESS_TTL: overrides?.ttl ?? '15m',
    },
  } as unknown as ConfigService;
  return new AppJwtService(new NestJwtService(), fakeConfig);
}

describe('AppJwtService', () => {
  it('mints a token with the exact claim shape from architecture section 7 (bound)', () => {
    const service = makeService();
    const token = service.mintAccessToken({
      sub: 'user-1',
      rv: 3,
      tid: 'tenant-1',
      mid: 'membership-1',
    });
    const claims = service.verifyAccessToken(token);

    expect(claims.sub).toBe('user-1');
    expect(claims.tid).toBe('tenant-1');
    expect(claims.mid).toBe('membership-1');
    expect(claims.rv).toBe(3);
    expect(claims.aud).toBe('tenant');
    expect(typeof claims.jti).toBe('string');
    expect(claims.jti.length).toBeGreaterThan(0);
  });

  it('mints an "unbound" token with no tid/mid when none are given', () => {
    const service = makeService();
    const token = service.mintAccessToken({ sub: 'user-1', rv: 1 });
    const claims = service.verifyAccessToken(token);

    expect(claims.tid).toBeUndefined();
    expect(claims.mid).toBeUndefined();
  });

  it('rejects a token signed with a different secret', () => {
    const serviceA = makeService();
    const serviceB = new AppJwtService(new NestJwtService(), {
      env: { JWT_SECRET: 'a-completely-different-secret-of-32-chars-plus', JWT_ACCESS_TTL: '15m' },
    } as unknown as ConfigService);

    const token = serviceA.mintAccessToken({ sub: 'user-1', rv: 1 });
    expect(() => serviceB.verifyAccessToken(token)).toThrow();
  });

  it('rejects an expired token', () => {
    const service = makeService({ ttl: '-1s' });
    const token = service.mintAccessToken({ sub: 'user-1', rv: 1 });
    expect(() => service.verifyAccessToken(token)).toThrow();
  });

  it('generates a distinct jti on every mint', () => {
    const service = makeService();
    const claimsA = service.verifyAccessToken(service.mintAccessToken({ sub: 'u', rv: 1 }));
    const claimsB = service.verifyAccessToken(service.mintAccessToken({ sub: 'u', rv: 1 }));
    expect(claimsA.jti).not.toBe(claimsB.jti);
  });

  describe('audience enforcement (Gate 2 red-team fix)', () => {
    const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';

    function signRawToken(payload: object): string {
      // Bypasses mintAccessToken (which always sets aud: 'tenant') to
      // construct tokens with an arbitrary/missing `aud`, signed with the
      // SAME secret AppJwtService trusts — exactly the forgery shape the
      // audience check must reject.
      return new NestJwtService().sign(payload, { secret: SECRET, algorithm: 'HS256' });
    }

    it('accepts a token with the correct tenant audience', () => {
      const service = makeService();
      const token = service.mintAccessToken({ sub: 'user-1', rv: 1 });
      expect(() => service.verifyAccessToken(token)).not.toThrow();
      expect(service.verifyAccessToken(token).aud).toBe(TENANT_TOKEN_AUDIENCE);
    });

    it('rejects a token with a different audience, even with a valid signature', () => {
      const service = makeService();
      const token = signRawToken({ sub: 'user-1', rv: 1, aud: 'platform', jti: 'x' });
      expect(() => service.verifyAccessToken(token)).toThrow();
    });

    it('rejects a token with no audience claim at all', () => {
      const service = makeService();
      const token = signRawToken({ sub: 'user-1', rv: 1, jti: 'x' });
      expect(() => service.verifyAccessToken(token)).toThrow();
    });
  });
});
