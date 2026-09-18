import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../../common/config/config.service';

const HEADER_NAME = 'x-platform-bootstrap-secret';

/**
 * Gate 2 stand-in for the architecture's real `PlatformGuard` (a
 * `platform_admin` JWT with `aud: 'platform'`). `POST /platform/auth/login`
 * is not built this gate — see docs/IMPLEMENTATION_STATUS.md — so
 * `POST /platform/tenants` is guarded by a pre-shared secret instead,
 * checked in constant time. This is deliberately narrow: it protects
 * exactly one bootstrap-only endpoint and nothing else reads
 * `platform_admin` or issues a platform-audience JWT in Gate 2.
 */
@Injectable()
export class PlatformBootstrapGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[HEADER_NAME];
    const expected = this.config.env.PLATFORM_BOOTSTRAP_SECRET;

    if (typeof provided !== 'string' || !constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException('Invalid platform bootstrap secret.');
    }
    return true;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
