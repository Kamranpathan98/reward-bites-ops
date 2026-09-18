import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  InviteUserRequest,
  MembershipListItem,
  PatchMembershipRequest,
} from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type ActorKind, type Pool } from '../../common/db';
import { hashPassword } from '../../common/security/password';
import { PermissionResolutionService } from '../../common/security/permission-resolution.service';
import { recordAuditEvent } from '../audit/audit-writer';
import { MembershipRepository } from './membership.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

export interface ActingUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly actorKind: ActorKind;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly userRepository: UserRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly roleRepository: RoleRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly permissions: PermissionResolutionService,
  ) {}

  async list(tenantId: string): Promise<MembershipListItem[]> {
    const rows = await withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, (tx) =>
      this.membershipRepository.listForTenant(tx, tenantId),
    );
    return rows.map((row) => ({
      membershipId: row.membershipId,
      userId: row.userId,
      email: row.email,
      fullName: row.fullName,
      status: row.status,
      roleId: row.roleId,
      roleName: row.roleName,
      joinedAt: row.joinedAt.toISOString(),
    }));
  }

  async invite(actor: ActingUser, input: InviteUserRequest): Promise<{ membershipId: string }> {
    const membershipId = await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const role = await this.roleRepository.findById(tx, input.roleId);
        if (!role) throw new NotFoundException('Role not found.');

        let user = await this.userRepository.findByEmail(tx, input.email);
        if (!user) {
          const passwordHash = await hashPassword(input.tempPassword);
          user = await this.userRepository.create(tx, {
            email: input.email,
            passwordHash,
            fullName: input.fullName,
          });
        }

        const existingMembership = await this.membershipRepository.findByTenantAndUser(
          tx,
          actor.tenantId,
          user.id,
        );
        if (existingMembership) {
          throw new ConflictException('This user is already a member of this tenant.');
        }

        const membership = await this.membershipRepository.create(tx, {
          tenantId: actor.tenantId,
          userId: user.id,
          roleId: input.roleId,
          invitedBy: actor.userId,
        });

        await recordAuditEvent(tx, {
          entityType: 'tenant_membership',
          entityId: membership.id,
          action: 'invited',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: { email: input.email, roleId: input.roleId },
        });

        return membership.id;
      },
    );

    return { membershipId };
  }

  async patch(
    actor: ActingUser,
    membershipId: string,
    input: PatchMembershipRequest,
  ): Promise<void> {
    const targetUserId = await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const membership = await this.membershipRepository.findRawById(
          tx,
          actor.tenantId,
          membershipId,
        );
        if (!membership) throw new NotFoundException('Membership not found.');

        if (input.roleId) {
          const role = await this.roleRepository.findById(tx, input.roleId);
          if (!role) throw new NotFoundException('Role not found.');
          await this.membershipRepository.updateRole(
            tx,
            actor.tenantId,
            membershipId,
            input.roleId,
          );
          await recordAuditEvent(tx, {
            entityType: 'tenant_membership',
            entityId: membershipId,
            action: 'role_changed',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            before: { roleId: membership.roleId },
            after: { roleId: input.roleId },
          });
        }

        if (input.status) {
          await this.membershipRepository.updateStatus(
            tx,
            actor.tenantId,
            membershipId,
            input.status,
          );
          await recordAuditEvent(tx, {
            entityType: 'tenant_membership',
            entityId: membershipId,
            action: 'status_changed',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            before: { status: membership.status },
            after: { status: input.status },
          });
        }

        // Role/status changes are security-relevant: bump the target's
        // security_version so their existing access tokens die within ~60s
        // (architecture section 7/8).
        await this.userRepository.bumpSecurityVersion(tx, membership.userId);

        return membership.userId;
      },
    );

    this.permissions.invalidateSecurityVersion(targetUserId);
    this.permissions.invalidatePermissions(actor.tenantId, membershipId);
  }

  async revokeSessions(actor: ActingUser, membershipId: string): Promise<void> {
    const targetUserId = await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const membership = await this.membershipRepository.findRawById(
          tx,
          actor.tenantId,
          membershipId,
        );
        if (!membership) throw new NotFoundException('Membership not found.');

        await this.refreshTokenRepository.revokeAllForMembership(tx, membershipId);

        // Gate 2 red-team finding: revoking sessions only stopped future
        // refreshes — the target's already-issued access token (up to
        // JWT_ACCESS_TTL) kept working. Bumping security_version, exactly
        // like the role/status-change path below, kills it immediately
        // (AuthGuard rejects on the next request, once the cache is
        // invalidated below).
        await this.userRepository.bumpSecurityVersion(tx, membership.userId);

        await recordAuditEvent(tx, {
          entityType: 'tenant_membership',
          entityId: membershipId,
          action: 'sessions_revoked',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });

        return membership.userId;
      },
    );

    this.permissions.invalidateSecurityVersion(targetUserId);
  }
}
