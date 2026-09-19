import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { DbModule } from './common/db/db.module';
import { SecurityModule } from './common/security/security.module';
import { HealthModule } from './health/health.module';
import { BillingModule } from './modules/billing/billing.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { IdentityModule } from './modules/identity/identity.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { TablesModule } from './modules/tables/tables.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    SecurityModule,
    HealthModule,
    TenancyModule,
    IdentityModule,
    PlatformModule,
    TablesModule,
    MenuModule,
    OrdersModule,
    KitchenModule,
    BillingModule,
    PaymentsModule,
    ExpensesModule,
    ReportingModule,
  ],
})
export class AppModule {}
