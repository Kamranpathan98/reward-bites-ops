import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { MembershipSummary } from '@rewardbite/contracts';
import { ConfigService } from '../../common/config/config.service';
import { DB_POOL, withGlobalTx, withTenantTx, type Pool } from '../../common/db';
import { AppJwtService } from '../../common/security/jwt.service';
import { PermissionResolutionService } from '../../common/security/permission-resolution.service';
import { hashPassword, verifyPassword } from '../../common/security/password';
import { generateRefreshToken, hashRefreshToken } from '../../common/security/refresh-token';
import { TenantRepository } from '../tenancy/tenant.repository';
import { LoginAttemptRepository } from './login-attempt.repository';
import { MembershipRepository, type RawMembership } from './membership.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

const LOGIN_LOCKOUT_WINDOW_MINUTES = 15;

export interface LoginResult {
  accessToken: string;
  memberships: MembershipSummary[];
  rawRefreshToken: string;
}

export interface AccessTokenResult {
  accessToken: string;
  rawRefreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly jwt: AppJwtService,
    private readonly permissions: PermissionResolutionService,
    private readonly userRepository: UserRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly roleRepository: RoleRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly loginAttemptRepository: LoginAttemptRepository,
    private readonly tenantRepository: TenantRepository,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string | null | undefined;
  }): Promise<LoginResult> {
    const recentFailures = await withGlobalTx(this.pool, { actorKind: 'staff' }, (tx) =>
      this.loginAttemptRepository.countRecentFailures(
        tx,
        input.email,
        LOGIN_LOCKOUT_WINDOW_MINUTES,
      ),
    );
    if (recentFailures >= this.config.env.LOGIN_LOCKOUT_THRESHOLD) {
      throw new HttpException(
        'Too many failed login attempts. Try again later.',
        HttpStatus.LOCKED,
      );
    }

    const user = await withGlobalTx(this.pool, { actorKind: 'staff' }, (tx) =>
      this.userRepository.findByEmail(tx, input.email),
    );
    // Always run a real Argon2id verify, even for an unknown email, so
    // response timing doesn't reveal whether the account exists
    // (architecture section 7, "Enumeration": identical errors for
    // unknown vs wrong password).
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword(await getDummyHash(), input.password);

    await withGlobalTx(this.pool, { actorKind: 'staff' }, (tx) =>
      this.loginAttemptRepository.record(tx, {
        email: input.email,
        ip: input.ip,
        success: passwordOk,
      }),
    );

    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const rawMemberships = await withGlobalTx(
      this.pool,
      { userId: user.id, actorKind: 'staff' },
      (tx) => this.membershipRepository.findActiveByUserId(tx, user.id),
    );
    const enriched = await this.enrichMemberships(user.id, rawMemberships);
    const bound = enriched.length === 1 ? enriched[0] : undefined;

    const accessToken = this.jwt.mintAccessToken({
      sub: user.id,
      rv: user.securityVersion,
      ...(bound ? { tid: bound.tenantId, mid: bound.membershipId } : {}),
    });

    const rawRefreshToken = generateRefreshToken();
    await withGlobalTx(this.pool, { userId: user.id, actorKind: 'staff' }, (tx) =>
      this.refreshTokenRepository.create(tx, {
        userId: user.id,
        membershipId: bound?.membershipId ?? null,
        tokenHash: hashRefreshToken(rawRefreshToken),
        ttlDays: this.config.env.REFRESH_TOKEN_TTL_DAYS,
        ip: input.ip,
      }),
    );

    return { accessToken, memberships: enriched, rawRefreshToken };
  }

  async selectTenant(input: {
    userId: string;
    membershipId: string;
    currentRawRefreshToken?: string | undefined;
  }): Promise<AccessTokenResult> {
    const [user, match] = await withGlobalTx(
      this.pool,
      { userId: input.userId, actorKind: 'staff' },
      async (tx) => {
        const memberships = await this.membershipRepository.findActiveByUserId(tx, input.userId);
        const found = memberships.find((m) => m.membershipId === input.membershipId);
        const u = await this.userRepository.findById(tx, input.userId);
        return [u, found] as const;
      },
    );

    if (!user) throw new UnauthorizedException();
    // Cross-tenant/foreign ids return 404, never 403 (architecture section 6, point 9).
    if (!match) throw new NotFoundException('Membership not found.');

    const accessToken = this.jwt.mintAccessToken({
      sub: user.id,
      rv: user.securityVersion,
      tid: match.tenantId,
      mid: match.membershipId,
    });

    const rawRefreshToken = generateRefreshToken();
    await withGlobalTx(this.pool, { userId: user.id, actorKind: 'staff' }, async (tx) => {
      let familyId: string | undefined;
      let previousId: string | undefined;
      if (input.currentRawRefreshToken) {
        const existing = await this.refreshTokenRepository.findByHash(
          tx,
          hashRefreshToken(input.currentRawRefreshToken),
        );
        if (existing && existing.userId === user.id && !existing.revokedAt) {
          familyId = existing.familyId;
          previousId = existing.id;
        }
      }

      const created = await this.refreshTokenRepository.create(tx, {
        userId: user.id,
        membershipId: match.membershipId,
        tokenHash: hashRefreshToken(rawRefreshToken),
        familyId,
        ttlDays: this.config.env.REFRESH_TOKEN_TTL_DAYS,
      });

      if (previousId) {
        await this.refreshTokenRepository.markRevoked(tx, previousId, created.id);
      }
    });

    return { accessToken, rawRefreshToken };
  }

  async refresh(rawToken: string): Promise<AccessTokenResult> {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await withGlobalTx(this.pool, { actorKind: 'staff' }, (tx) =>
      this.refreshTokenRepository.findByHash(tx, tokenHash),
    );
    if (!existing) throw new UnauthorizedException('Invalid refresh token.');

    if (existing.revokedAt) {
      // Reuse of an already-rotated token: theft signal, revoke the whole family.
      await withGlobalTx(this.pool, { userId: existing.userId, actorKind: 'staff' }, (tx) =>
        this.refreshTokenRepository.revokeFamily(tx, existing.familyId),
      );
      throw new UnauthorizedException('Refresh token has been revoked.');
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    const user = await withGlobalTx(
      this.pool,
      { userId: existing.userId, actorKind: 'staff' },
      (tx) => this.userRepository.findById(tx, existing.userId),
    );
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();

    let tenantId: string | undefined;
    if (existing.membershipId) {
      const membership = await withGlobalTx(
        this.pool,
        { userId: user.id, actorKind: 'staff' },
        (tx) =>
          this.membershipRepository.findRawByIdForUser(
            tx,
            existing.membershipId as string,
            user.id,
          ),
      );
      tenantId = membership?.tenantId;
    }

    const rawRefreshToken = generateRefreshToken();
    await withGlobalTx(this.pool, { userId: user.id, actorKind: 'staff' }, async (tx) => {
      const created = await this.refreshTokenRepository.create(tx, {
        userId: user.id,
        membershipId: existing.membershipId,
        tokenHash: hashRefreshToken(rawRefreshToken),
        familyId: existing.familyId,
        ttlDays: this.config.env.REFRESH_TOKEN_TTL_DAYS,
      });
      await this.refreshTokenRepository.markRevoked(tx, existing.id, created.id);
    });

    const accessToken = this.jwt.mintAccessToken({
      sub: user.id,
      rv: user.securityVersion,
      ...(tenantId && existing.membershipId ? { tid: tenantId, mid: existing.membershipId } : {}),
    });

    return { accessToken, rawRefreshToken };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await withGlobalTx(this.pool, { actorKind: 'staff' }, (tx) =>
      this.refreshTokenRepository.findByHash(tx, tokenHash),
    );
    if (!existing) return; // Already gone; logout is idempotent.
    await withGlobalTx(this.pool, { userId: existing.userId, actorKind: 'staff' }, (tx) =>
      this.refreshTokenRepository.revokeFamily(tx, existing.familyId),
    );
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await withGlobalTx(this.pool, { userId, actorKind: 'staff' }, (tx) =>
      this.userRepository.findById(tx, userId),
    );
    if (!user) throw new UnauthorizedException();

    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect.');

    const newHash = await hashPassword(newPassword);
    await withGlobalTx(this.pool, { userId, actorKind: 'staff' }, (tx) =>
      this.userRepository.updatePasswordHash(tx, userId, newHash),
    );
    this.permissions.invalidateSecurityVersion(userId);
  }

  private async enrichMemberships(
    userId: string,
    raw: RawMembership[],
  ): Promise<MembershipSummary[]> {
    return Promise.all(
      raw.map(async (m) => {
        const { tenantName, tenantSlug, roleName } = await withTenantTx(
          this.pool,
          { tenantId: m.tenantId, userId, actorKind: 'staff' },
          async (tx) => {
            const tenant = await this.tenantRepository.findById(tx, m.tenantId);
            const role = await this.roleRepository.findById(tx, m.roleId);
            return {
              tenantName: tenant?.name ?? '',
              tenantSlug: tenant?.slug ?? '',
              roleName: role?.name ?? '',
            };
          },
        );
        return {
          membershipId: m.membershipId,
          tenantId: m.tenantId,
          tenantName,
          tenantSlug,
          roleName,
        };
      }),
    );
  }
}

// A real Argon2id hash (computed once, lazily, at the real cost
// parameters) that no real password will ever match — verifying against
// it keeps login's timing profile the same for an unknown email as for a
// wrong password on a real one.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}
