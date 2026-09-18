import { ConflictException, Injectable } from '@nestjs/common';
import type { SignupRequest } from '@rewardbite/contracts';
import { isUniqueViolation } from '../../common/db';
import { AuthService, type LoginResult } from '../identity/auth.service';
import { PlatformService, TenantSlugConflictError } from './platform.service';
import { baseSlugFrom, nextSlugCandidate } from './tenant-slug';

const MAX_SLUG_ATTEMPTS = 20;

/**
 * Self-service restaurant onboarding (docs/IMPLEMENTATION_STATUS.md
 * "Onboarding" section — the architectural decision and its rationale are
 * written up there in full, not duplicated as a comment here).
 *
 * Deliberately thin: every actual write goes through
 * `PlatformService.provisionTenant()` (the exact transaction
 * `POST /platform/tenants` already uses) and `AuthService.login()` (the
 * exact token-issuance `POST /auth/login` already uses). This service
 * adds only what genuinely differs for public self-service signup:
 * server-side slug generation with collision retry, and wiring the two
 * reused pieces together. Abuse throttling lives in `SignupRateLimitGuard`
 * instead — it needs to run before Zod validation (Nest's pipeline runs
 * guards before pipes), so a malformed-payload flood is still throttled.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly platformService: PlatformService,
    private readonly authService: AuthService,
  ) {}

  async signup(input: SignupRequest, ip: string | null): Promise<LoginResult> {
    await this.provisionWithUniqueSlug(input);

    // Auto-login (task instruction section 7): the exact same token
    // issuance POST /auth/login uses. Its own logic binds the JWT to the
    // tenant automatically since the new owner has exactly one membership.
    return this.authService.login({ email: input.email, password: input.password, ip });
  }

  private async provisionWithUniqueSlug(input: SignupRequest): Promise<string> {
    const baseSlug = baseSlugFrom(input.tenantName);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = nextSlugCandidate(baseSlug, attempt);
      try {
        const result = await this.platformService.provisionTenant(
          {
            name: input.tenantName,
            slug,
            ownerEmail: input.email,
            ownerPassword: input.password,
          },
          { ownerName: input.ownerName, allowExistingOwner: false },
        );
        return result.tenantId;
      } catch (err) {
        // Two distinct "this slug is taken" signals, both retry-worthy:
        // provisionTenant's own pre-check (TenantSlugConflictError, the
        // common non-racy case) and a real tenant_slug_unique violation
        // from the database (the genuine-concurrency case, two identical
        // restaurant names racing — arbitrated by the constraint, never
        // guessed at).
        if (err instanceof TenantSlugConflictError || isUniqueViolation(err, 'tenant_slug_unique'))
          continue;

        // The mirror case for email: provisionTenant's own findByEmail
        // pre-check (allowExistingOwner: false) is a plain SELECT, not a
        // lock — two truly concurrent signups for the same brand-new email
        // can both pass it before either commits. The database is the
        // final arbiter (task section 23: "do not rely only on
        // application pre-checks"); a raw user_email_unique violation from
        // that genuine race is mapped to the exact same safe, typed
        // rejection the common-case pre-check already throws, never left
        // to surface as an unhandled 500.
        if (isUniqueViolation(err, 'user_email_unique')) {
          throw new ConflictException('An account with this email already exists.');
        }

        // Any other failure must propagate immediately, not be swallowed
        // into a retry (onboarding task section 10).
        throw err;
      }
    }
    throw new ConflictException(
      'Could not generate a unique restaurant identifier. Try a slightly different name.',
    );
  }
}
