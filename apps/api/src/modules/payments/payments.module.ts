import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { BillingModule } from '../billing/billing.module';
import { PaymentRepository } from './payment.repository';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [DbModule, BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentRepository, PaymentsService],
})
export class PaymentsModule {}
