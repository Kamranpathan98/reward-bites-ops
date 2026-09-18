import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  createTenantRequestSchema,
  type CreateTenantRequest,
  type CreateTenantResponse,
} from '@rewardbite/contracts';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PlatformBootstrapGuard } from './platform-bootstrap.guard';
import { PlatformService } from './platform.service';

@Controller('platform')
@UseGuards(PlatformBootstrapGuard)
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Post('tenants')
  async createTenant(
    @Body(new ZodValidationPipe(createTenantRequestSchema)) body: CreateTenantRequest,
  ): Promise<{ data: CreateTenantResponse }> {
    const result = await this.platformService.provisionTenant(body);
    return { data: { tenantId: result.tenantId } };
  }
}
