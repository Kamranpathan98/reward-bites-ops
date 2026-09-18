import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  signupRequestSchema,
  type SignupRequest,
  type SignupResponse,
} from '@rewardbite/contracts';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ConfigService } from '../../common/config/config.service';
import { setRefreshCookie } from '../identity/refresh-cookie';
import { SignupRateLimitGuard } from './signup-rate-limit.guard';
import { SignupService } from './signup.service';

/**
 * `POST /auth/signup` — self-service restaurant onboarding entry point
 * (docs/IMPLEMENTATION_STATUS.md "Onboarding" section has the full
 * architectural decision). Deliberately its own controller, not added to
 * `PlatformController`: that controller is entirely gated by
 * `PlatformBootstrapGuard` for ops-only tenant creation, and signup must
 * be genuinely public. It shares the `/auth` prefix with `AuthController`
 * (identity module) because it IS an auth entry point from the client's
 * perspective — `/app/login` remains completely untouched.
 */
@Controller('auth')
export class SignupController {
  constructor(
    private readonly signupService: SignupService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SignupRateLimitGuard)
  async signup(
    @Body(new ZodValidationPipe(signupRequestSchema)) body: SignupRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignupResponse> {
    const result = await this.signupService.signup(body, req.ip ?? null);
    setRefreshCookie(res, this.config, result.rawRefreshToken);
    return { accessToken: result.accessToken, memberships: result.memberships };
  }
}
