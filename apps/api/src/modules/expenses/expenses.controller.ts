import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createExpenseCategoryRequestSchema,
  createExpenseRequestSchema,
  listExpensesQuerySchema,
  updateExpenseCategoryRequestSchema,
  updateExpenseRequestSchema,
  type CreateExpenseCategoryRequest,
  type CreateExpenseRequest,
  type ExpenseCategory,
  type ExpenseCategoryListResponse,
  type ExpenseDetailResponse,
  type ExpensesListResponse,
  type ListExpensesQuery,
  type UpdateExpenseCategoryRequest,
  type UpdateExpenseRequest,
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
import { ExpensesService, type ActingStaff } from './expenses.service';

function actorFrom(user: AuthenticatedUser): ActingStaff {
  return {
    userId: user.userId,
    tenantId: user.tenantId as string,
    membershipId: user.membershipId as string,
    actorKind: 'staff',
  };
}

@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // ---------------------------------------------------------------------------
  // Categories: /expense-categories
  // ---------------------------------------------------------------------------

  @Get('expense-categories')
  @RequirePermission('expenses.read')
  async listCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ExpenseCategoryListResponse> {
    const data = await this.expensesService.listCategories(
      actorFrom(user),
      includeInactive === 'true',
    );
    return { data };
  }

  @Get('expense-categories/:id')
  @RequirePermission('expenses.read')
  async getCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ExpenseCategory }> {
    const data = await this.expensesService.getCategory(actorFrom(user), id);
    return { data };
  }

  @Post('expense-categories')
  @RequirePermission('expenses.manage')
  async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createExpenseCategoryRequestSchema))
    body: CreateExpenseCategoryRequest,
  ): Promise<{ data: ExpenseCategory }> {
    const data = await this.expensesService.createCategory(actorFrom(user), body);
    return { data };
  }

  @Patch('expense-categories/:id')
  @RequirePermission('expenses.manage')
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateExpenseCategoryRequestSchema))
    body: UpdateExpenseCategoryRequest,
  ): Promise<{ data: ExpenseCategory }> {
    const data = await this.expensesService.updateCategory(actorFrom(user), id, body);
    return { data };
  }

  @Delete('expense-categories/:id')
  @RequirePermission('expenses.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.expensesService.deleteCategory(actorFrom(user), id);
  }

  // ---------------------------------------------------------------------------
  // Expenses: /expenses
  // ---------------------------------------------------------------------------

  @Get('expenses')
  @RequirePermission('expenses.read')
  async listExpenses(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listExpensesQuerySchema))
    query: ListExpensesQuery,
  ): Promise<ExpensesListResponse> {
    return this.expensesService.listExpenses(actorFrom(user), query);
  }

  @Get('expenses/:id')
  @RequirePermission('expenses.read')
  async getExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExpenseDetailResponse> {
    const data = await this.expensesService.getExpense(actorFrom(user), id);
    return { data };
  }

  @Post('expenses')
  @RequirePermission('expenses.manage')
  async createExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createExpenseRequestSchema))
    body: CreateExpenseRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ExpenseDetailResponse> {
    const { expense, replay } = await this.expensesService.createExpense(
      actorFrom(user),
      body,
    );
    res.status(replay ? HttpStatus.OK : HttpStatus.CREATED);
    return { data: expense };
  }

  @Patch('expenses/:id')
  @RequirePermission('expenses.manage')
  async updateExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateExpenseRequestSchema))
    body: UpdateExpenseRequest,
  ): Promise<ExpenseDetailResponse> {
    const data = await this.expensesService.updateExpense(actorFrom(user), id, body);
    return { data };
  }

  @Delete('expenses/:id')
  @RequirePermission('expenses.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.expensesService.deleteExpense(actorFrom(user), id);
  }
}

