import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  dashboardBreakdownQuerySchema,
  dashboardQuerySchema,
  type DashboardBreakdown,
  type DashboardBreakdownQuery,
  type DashboardQuery,
  type DashboardSummary,
} from '@rewardbite/contracts';
import {
  AuthGuard,
  CurrentUser,
  PermissionGuard,
  RequirePermission,
  type AuthenticatedUser,
} from '../../common/guards';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ReportingService, type ActingStaff } from './reporting.service';

function actorFrom(user: AuthenticatedUser): ActingStaff {
  return {
    userId: user.userId,
    tenantId: user.tenantId as string,
    membershipId: user.membershipId as string,
    actorKind: 'staff',
  };
}

@Controller('dashboard')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('summary')
  @RequirePermission('dashboard.read')
  async getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema))
    query: DashboardQuery,
  ): Promise<{ data: DashboardSummary }> {
    const data = await this.reportingService.getSummary(actorFrom(user), query);
    return { data };
  }

  @Get('breakdown')
  @RequirePermission('dashboard.read')
  async getBreakdown(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(dashboardBreakdownQuerySchema))
    query: DashboardBreakdownQuery,
  ): Promise<{ data: DashboardBreakdown }> {
    const data = await this.reportingService.getBreakdown(actorFrom(user), query);
    return { data };
  }
}

