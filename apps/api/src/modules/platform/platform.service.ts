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
   */
  async provisionTenant(input: CreateTenantRequest): Promise<{ tenantId: string }> {
    const tenantId = newId();

    await withTenantTx(this.pool, { tenantId, actorKind: 'platform' }, async (tx) => {
      const existingSlug = await this.tenantRepository.findBySlug(tx, input.slug);
      if (existingSlug) {
        throw new ConflictException('A tenant with this slug already exists.');
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
      if (!owner) {
        const passwordHash = await hashPassword(input.ownerPassword);
        // The architecture's POST /platform/tenants body has no owner
        // display name field — falling back to the email's local part is
        // a reasonable placeholder until the owner sets their own name.
        const fallbackName = input.ownerEmail.split('@')[0] ?? input.ownerEmail;
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
