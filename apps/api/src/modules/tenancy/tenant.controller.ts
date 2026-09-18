import { Controller, Get, Inject, NotFoundException, UseGuards } from '@nestjs/common';
import type { Tenant } from '@rewardbite/contracts';
import {
  AuthGuard,
  CurrentUser,
  PermissionGuard,
  RequirePermission,
  type AuthenticatedUser,
} from '../../common/guards';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { TenantRepository } from './tenant.repository';

@Controller('tenant')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class TenantController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly tenantRepository: TenantRepository,
  ) {}

  @Get()
  @RequirePermission('tenant.read')
  async getCurrentTenant(@CurrentUser() user: AuthenticatedUser): Promise<{ data: Tenant }> {
    // TenantGuard already guarantees user.tenantId is set.
    const tenantId = user.tenantId as string;
    const tenant = await withTenantTx(
      this.pool,
      { tenantId, userId: user.userId, actorKind: 'staff' },
      (tx) => this.tenantRepository.findById(tx, tenantId),
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        timezone: tenant.timezone,
        currency: tenant.currency,
        status: tenant.status,
        logoKey: tenant.logoKey,
        contactPhone: tenant.contactPhone,
        contactEmail: tenant.contactEmail,
        address: tenant.address,
      },
    };
  }
}
