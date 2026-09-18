import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createTableRequestSchema,
  patchTableRequestSchema,
  type CreateTableRequest,
  type PatchTableRequest,
  type RegenerateQrResponse,
  type TablesListResponse,
  type TablesLiveResponse,
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
import { TablesService } from './tables.service';

@Controller('tables')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @RequirePermission('tables.read')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<TablesListResponse> {
    const data = await this.tablesService.list(user.tenantId as string);
    return { data };
  }

  @Get('live')
  @RequirePermission('sessions.read')
  async live(@CurrentUser() user: AuthenticatedUser): Promise<TablesLiveResponse> {
    const data = await this.tablesService.liveView(user.tenantId as string);
    return { data };
  }

  @Get('qr-sheet.pdf')
  @RequirePermission('tables.read')
  async qrSheetPdf(@CurrentUser() user: AuthenticatedUser, @Res() res: Response): Promise<void> {
    const pdf = await this.tablesService.renderQrSheetPdf(user.tenantId as string);
    res.type('application/pdf').send(pdf);
  }

  @Post()
  @RequirePermission('tables.manage')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTableRequestSchema)) body: CreateTableRequest,
  ): Promise<{ data: { id: string } }> {
    const data = await this.tablesService.create(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data };
  }

  @Patch(':id')
  @RequirePermission('tables.manage')
  async patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchTableRequestSchema)) body: PatchTableRequest,
  ): Promise<{ data: true }> {
    await this.tablesService.patch(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body,
    );
    return { data: true };
  }

  @Delete(':id')
  @RequirePermission('tables.manage')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ data: true }> {
    await this.tablesService.softDelete(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    return { data: true };
  }

  @Post(':id/qr/regenerate')
  @RequirePermission('tables.manage')
  async regenerateQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ data: RegenerateQrResponse['data'] }> {
    const data = await this.tablesService.regenerateQr(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    return { data };
  }

  @Get(':id/qr.svg')
  @RequirePermission('tables.read')
  async qrSvg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const svg = await this.tablesService.renderQrSvg(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    res.type('image/svg+xml').send(svg);
  }
}
