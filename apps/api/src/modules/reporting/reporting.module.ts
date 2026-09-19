import { Module } from '@nestjs/common';
import { DbModule } from '../../common/db';
import { ReportingController } from './reporting.controller';
import { ReportingRepository } from './reporting.repository';
import { ReportingService } from './reporting.service';

@Module({
  imports: [DbModule],
  controllers: [ReportingController],
  providers: [ReportingRepository, ReportingService],
  exports: [ReportingRepository, ReportingService],
})
export class ReportingModule {}

