import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { CreateTenantRequest } from '@rewardbite/contracts';
import { withTenantTx, type Pool } from '../../common/db';
import { hashPassword } from '../../common/security/password';
import { newId } from '../../common/security/id';
import { MembershipRepository } from '../identity/membership.repository';
import { RoleRepository } from '../identity/role.repository';
import { UserRepository } from '../identity/user.repository';
import { TenantRepository } from '../tenancy/tenant.repository';
import { recordAuditEvent } from '../audit/audit-writer';
import { PLATFORM_DB_POOL } from './platform-db.module';
import { SYSTEM_ROLE_TEMPLATES } from './system-role-templates';

/**
 * A `ConflictException` subtype specifically for the slug pre-check below
 * — same 409 status, same message, same behavior for the existing
 * `POST /platform/tenants` caller, but `instanceof`-distinguishable from
 * the owner-email conflict a few lines later. `SignupService` needs that
 * distinction: a slug conflict is retry-worthy (try the next candidate
 * slug), an email conflict must propagate immediately (onboarding task
 * section 10) — string-matching the message would be fragile.
 */
export class TenantSlugConflictError extends ConflictException {
  constructor() {
    super('A tenant with this slug already exists.');
  }
}

@Injectable()
export class PlatformService {
  constructor(
    @Inject(PLATFORM_DB_POOL) private readonly pool: Pool,
    private readonly tenantRepository: TenantRepository,
    private readonly roleRepository: RoleRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * "tenant + settings + system roles + owner membership, one
   * transaction" (architecture section 12). The id is generated here,
   * client-side (architecture section 11), before any INSERT — which is
   * what lets this whole transaction run through `withTenantTx` with that
   * id as the tenant context from the very first statement, satisfying
   * every table's WITH CHECK policy including `tenant` itself.
   *
   * `options` is additive for self-service signup (SignupService) — every
   * existing caller (`PlatformController.createTenant`, i.e.
   * `POST /platform/tenants`) omits it and gets byte-for-byte the same
   * behavior as before this parameter existed:
   *  - `ownerName`: platform-admin-initiated creation has no owner-name
   *    field in its contract, so it still falls back to the email's local
   *    part; signup has a real name field and passes it here.
   *  - `allowExistingOwner` (default `true`, matching the original
   *    behavior): platform-admin creation may legitimately attach an
   *    already-registered platform user to a brand-new tenant. Public
   *    signup must never do that silently (onboarding task section 10) —
   *    it passes `false`, which turns the "user already exists" branch
   *    into a thrown conflict instead of a silent reuse.
   */
  async provisionTenant(
    input: CreateTenantRequest,
    options?: { readonly ownerName?: string; readonly allowExistingOwner?: boolean },
  ): Promise<{ tenantId: string }> {
    const allowExistingOwner = options?.allowExistingOwner ?? true;
    const tenantId = newId();

    await withTenantTx(this.pool, { tenantId, actorKind: 'platform' }, async (tx) => {
      const existingSlug = await this.tenantRepository.findBySlug(tx, input.slug);
      if (existingSlug) {
        throw new TenantSlugConflictError();
      }

      await this.tenantRepository.create(tx, { id: tenantId, name: input.name, slug: input.slug });
      await this.tenantRepository.createDefaultSettings(tx, tenantId);

      let ownerRoleId: string | undefined;
      for (const template of SYSTEM_ROLE_TEMPLATES) {
        const role = await this.roleRepository.create(tx, tenantId, template.name, true);
        if (template.name === 'Owner') ownerRoleId = role.id;

        for (const permissionKey of template.permissions) {
          await tx.query(
            `INSERT INTO role_permission (tenant_id, role_id, permission_key) VALUES ($1, $2, $3)`,
            [tenantId, role.id, permissionKey],
          );
        }
      }
      if (!ownerRoleId)
        throw new Error('Owner role template is missing from SYSTEM_ROLE_TEMPLATES');

      let owner = await this.userRepository.findByEmail(tx, input.ownerEmail);
      if (owner && !allowExistingOwner) {
        throw new ConflictException('An account with this email already exists.');
      }
      if (!owner) {
        const passwordHash = await hashPassword(input.ownerPassword);
        // The architecture's POST /platform/tenants body has no owner
        // display name field — falling back to the email's local part is
        // a reasonable placeholder until the owner sets their own name.
        const fallbackName =
          options?.ownerName ?? input.ownerEmail.split('@')[0] ?? input.ownerEmail;
        owner = await this.userRepository.create(tx, {
          email: input.ownerEmail,
          passwordHash,
          fullName: fallbackName,
        });
      }

      await this.membershipRepository.create(tx, {
        tenantId,
        userId: owner.id,
        roleId: ownerRoleId,
        invitedBy: null,
      });

      await recordAuditEvent(tx, {
        entityType: 'tenant',
        entityId: tenantId,
        action: 'created',
        actorKind: 'platform',
        actorId: null,
        after: { name: input.name, slug: input.slug },
      });
    });

    return { tenantId };
  }
}
