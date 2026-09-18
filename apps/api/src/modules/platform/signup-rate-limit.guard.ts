import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { withGlobalTx, type Pool } from '../../common/db';
import { ConfigService } from '../../common/config/config.service';
import { PLATFORM_DB_POOL } from './platform-db.module';
import { PublicRateLimitRepository } from './public-rate-limit.repository';

/**
 * Signup abuse throttle (onboarding task section 12) as a Guard, not
 * service-internal logic — Nest's pipeline runs guards before the Zod
 * validation pipe, so this counts a malformed-payload flood against the
 * same IP window too, not just successfully-validated requests. Postgres-
 * backed (public_rate_limit), so it is genuinely shared across every API
 * instance — explicitly NOT a distributed edge/WAF-level defense; the
 * architecture's own outer layer for /auth/* is a Cloudflare rate rule
 * (infra, not in this repo).
 */
@Injectable()
export class SignupRateLimitGuard implements CanActivate {
  constructor(
    @Inject(PLATFORM_DB_POOL) private readonly platformPool: Pool,
    private readonly rateLimitRepository: PublicRateLimitRepository,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = `signup:ip:${request.ip ?? 'unknown'}`;

    const { count } = await withGlobalTx(this.platformPool, { actorKind: 'platform' }, (tx) =>
      this.rateLimitRepository.touch(tx, key, this.config.env.SIGNUP_RATE_LIMIT_WINDOW_MINUTES),
    );

    if (count > this.config.env.SIGNUP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many signup attempts from this network. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
