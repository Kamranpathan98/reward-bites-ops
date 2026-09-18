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
  UseGuards,
} from '@nestjs/common';
import {
  createAddonRequestSchema,
  createCategoryRequestSchema,
  createItemRequestSchema,
  createVariantRequestSchema,
  patchAddonRequestSchema,
  patchCategoryRequestSchema,
  patchItemRequestSchema,
  patchVariantRequestSchema,
  reorderRequestSchema,
  updateAvailabilityRequestSchema,
  type CreateAddonRequest,
  type CreateCategoryRequest,
  type CreateItemRequest,
  type CreateVariantRequest,
  type MenuTreeResponse,
  type PatchAddonRequest,
  type PatchCategoryRequest,
  type PatchItemRequest,
  type PatchVariantRequest,
  type ReorderRequest,
  type UpdateAvailabilityRequest,
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
import { MenuSnapshotService } from './menu-snapshot.service';
import { MenuService } from './menu.service';

@Controller('menu')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly snapshotService: MenuSnapshotService,
  ) {}

  @Get()
  @RequirePermission('menu.read')
  async getTree(@CurrentUser() user: AuthenticatedUser): Promise<MenuTreeResponse> {
    const data = await this.snapshotService.getFullTree(user.tenantId as string);
    return { data };
  }

  // ---- categories ---------------------------------------------------

  @Post('categories')
  @RequirePermission('menu.manage')
  async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCategoryRequestSchema)) body: CreateCategoryRequest,
  ): Promise<{ data: { id: string } }> {
    const data = await this.menuService.createCategory(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data };
  }

  @Patch('categories/:id')
  @RequirePermission('menu.manage')
  async patchCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchCategoryRequestSchema)) body: PatchCategoryRequest,
  ): Promise<{ data: true }> {
    await this.menuService.patchCategory(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body,
    );
    return { data: true };
  }

  @Delete('categories/:id')
  @RequirePermission('menu.manage')
  @HttpCode(HttpStatus.OK)
  async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ data: true }> {
    await this.menuService.deleteCategory(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    return { data: true };
  }

  // ---- items -------------------------------------------------------

  @Post('items')
  @RequirePermission('menu.manage')
  async createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createItemRequestSchema)) body: CreateItemRequest,
  ): Promise<{ data: { id: string } }> {
    const data = await this.menuService.createItem(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data };
  }

  @Patch('items/:id')
  @RequirePermission('menu.manage')
  async patchItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchItemRequestSchema)) body: PatchItemRequest,
  ): Promise<{ data: true }> {
    await this.menuService.patchItem(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body,
    );
    return { data: true };
  }

  @Delete('items/:id')
  @RequirePermission('menu.manage')
  @HttpCode(HttpStatus.OK)
  async deleteItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ data: true }> {
    await this.menuService.deleteItem(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    return { data: true };
  }

  @Patch('items/:id/availability')
  @RequirePermission('menu.availability.update')
  async updateItemAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAvailabilityRequestSchema)) body: UpdateAvailabilityRequest,
  ): Promise<{ data: true }> {
    await this.menuService.updateItemAvailability(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body.isAvailable,
    );
    return { data: true };
  }

  // ---- variants ---------------------------------------------------

  @Post('variants')
  @RequirePermission('menu.manage')
  async createVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createVariantRequestSchema)) body: CreateVariantRequest,
  ): Promise<{ data: { id: string } }> {
    const data = await this.menuService.createVariant(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data };
  }

  @Patch('variants/:id')
  @RequirePermission('menu.manage')
  async patchVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchVariantRequestSchema)) body: PatchVariantRequest,
  ): Promise<{ data: true }> {
    await this.menuService.patchVariant(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body,
    );
    return { data: true };
  }

  @Delete('variants/:id')
  @RequirePermission('menu.manage')
  @HttpCode(HttpStatus.OK)
  async deleteVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ data: true }> {
    await this.menuService.deleteVariant(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    return { data: true };
  }

  @Patch('variants/:id/availability')
  @RequirePermission('menu.availability.update')
  async updateVariantAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAvailabilityRequestSchema)) body: UpdateAvailabilityRequest,
  ): Promise<{ data: true }> {
    await this.menuService.updateVariantAvailability(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body.isAvailable,
    );
    return { data: true };
  }

  // ---- addons --------------------------------------------------------

  @Post('addons')
  @RequirePermission('menu.manage')
  async createAddon(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAddonRequestSchema)) body: CreateAddonRequest,
  ): Promise<{ data: { id: string } }> {
    const data = await this.menuService.createAddon(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data };
  }

  @Patch('addons/:id')
  @RequirePermission('menu.manage')
  async patchAddon(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchAddonRequestSchema)) body: PatchAddonRequest,
  ): Promise<{ data: true }> {
    await this.menuService.patchAddon(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
      body,
    );
    return { data: true };
  }

  @Delete('addons/:id')
  @RequirePermission('menu.manage')
  @HttpCode(HttpStatus.OK)
  async deleteAddon(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ data: true }> {
    await this.menuService.deleteAddon(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      id,
    );
    return { data: true };
  }

  // ---- reorder --------------------------------------------------------

  @Post('reorder')
  @RequirePermission('menu.manage')
  async reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(reorderRequestSchema)) body: ReorderRequest,
  ): Promise<{ data: true }> {
    await this.menuService.reorder(
      { userId: user.userId, tenantId: user.tenantId as string, actorKind: 'staff' },
      body,
    );
    return { data: true };
  }
}
