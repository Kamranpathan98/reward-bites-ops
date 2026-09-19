import { Controller, Get, Inject, Patch, UseGuards, Body } from '@nestjs/common';
import {
  patchOrganizationPaymentSettingsRequestSchema,
  type OrganizationSettingsResponse,
  type PatchOrganizationPaymentSettingsRequest,
} from '@rewardbite/contracts';
import {
  AuthGuard,
  CurrentUser,
  PermissionGuard,
  RequirePermission,
  type AuthenticatedUser,
} from '../../common/guards';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { SettingsService } from './settings.service';

/**
 * Organization settings endpoints.
 *
 * GET /api/v1/organization/settings
 *   Permission: settings.read
 *   Returns payment settings for authenticated tenant.
 *
 * PATCH /api/v1/organization/settings
 *   Permission: settings.payments.manage
 *   Updates payment settings; validation applied to final merged state.
 *   Audit event created transactionally on actual changes.
 *   Last-writer-wins (no optimistic concurrency).
 */
@Controller('organization/settings')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class SettingsController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  @RequirePermission('settings.read')
  async getSettings(@CurrentUser() user: AuthenticatedUser): Promise<OrganizationSettingsResponse> {
    const tenantId = user.tenantId as string;

    const settings = await withTenantTx(
      this.pool,
      { tenantId, userId: user.userId, actorKind: 'staff' },
      (tx) => this.settingsService.getPaymentSettings(tx, tenantId),
    );

    return {
      data: settings,
    };
  }

  @Patch()
  @RequirePermission('settings.payments.manage')
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(patchOrganizationPaymentSettingsRequestSchema))
    body: PatchOrganizationPaymentSettingsRequest,
  ): Promise<OrganizationSettingsResponse> {
    const tenantId = user.tenantId as string;

    const settings = await withTenantTx(
      this.pool,
      { tenantId, userId: user.userId, actorKind: 'staff' },
      (tx) => this.settingsService.updatePaymentSettings(tx, tenantId, user.userId, body),
    );

    return {
      data: settings,
    };
  }
}
