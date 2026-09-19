import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { ExpenseCategoryRepository } from './expense-category.repository';
import { ExpenseRepository } from './expense.repository';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [DbModule],
  controllers: [ExpensesController],
  providers: [
    ExpenseCategoryRepository,
    ExpenseRepository,
    ExpensesService,
  ],
  exports: [
    ExpenseCategoryRepository,
    ExpenseRepository,
    ExpensesService,
  ],
})
export class ExpensesModule {}

