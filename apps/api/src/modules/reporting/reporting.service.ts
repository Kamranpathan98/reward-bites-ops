import { Inject, Injectable } from '@nestjs/common';
import type {
  DashboardBreakdown,
  DashboardBreakdownQuery,
  DashboardQuery,
  DashboardSummary,
} from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import {
  ReportingRepository,
  type TenantContextInfo,
} from './reporting.repository';

export interface ActingStaff {
  userId: string;
  tenantId: string;
  membershipId: string;
  actorKind: 'staff';
}

const DISCLAIMER_TEXT =
  'Operating result reflects revenue minus expenses within this business period. Outstanding paise reflects all-time unsettled bills across all dates.';

/**
 * Given a tenant's local business date (YYYY-MM-DD), compute the from/to dates
 * for period: 'today', 'week', 'month'.
 */
function resolveDateRange(
  period: 'today' | 'week' | 'month',
  businessDate: string,
): { from: string; to: string } {
  const parts = businessDate.split('-');
  const yearStr = parts[0] ?? '1970';
  const monthStr = parts[1] ?? '01';
  const dayStr = parts[2] ?? '01';

  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  const d = parseInt(dayStr, 10);

  // Use UTC calendar methods so there are no local Node timezone shifts
  const cur = new Date(Date.UTC(y, m, d));

  if (period === 'today') {
    return { from: businessDate, to: businessDate };
  }

  if (period === 'week') {
    // Current week starting on Monday
    const dayOfWeek = cur.getUTCDay(); // 0 is Sunday, 1 is Monday, ...
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(cur.getTime() - diffToMonday * 86400000);
    const fromStr = monday.toISOString().substring(0, 10);
    return { from: fromStr, to: businessDate };
  }

  // month: 1st of current month to current businessDate
  const fromStr = `${yearStr}-${monthStr.padStart(2, '0')}-01`;
  return { from: fromStr, to: businessDate };
}

@Injectable()
export class ReportingService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly reportingRepository: ReportingRepository,
  ) {}

  /**
   * Determine current business date for tenant in database
   */
  async getCurrentBusinessDate(
    tenantInfo: TenantContextInfo,
  ): Promise<string> {
    return withTenantTx(
      this.pool,
      { tenantId: tenantInfo.tenantId, actorKind: 'staff' },
      async (tx) => {
        const res = await tx.query<{ business_date: string }>(
          `SELECT (((now() AT TIME ZONE $1) - $2::time)::date)::text as business_date`,
          [tenantInfo.timezone, tenantInfo.businessDayStartsAt],
        );
        const row = res.rows[0];
        if (!row) {
          throw new Error('Unable to compute current business date');
        }
        return row.business_date;
      },
    );
  }

  async getSummary(
    actor: ActingStaff,
    query: DashboardQuery,
  ): Promise<DashboardSummary> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const tenantInfo = await this.reportingRepository.getTenantContextInfo(
          tx,
          actor.tenantId,
        );

        let businessDate: string;
        if (query.date) {
          businessDate = query.date;
        } else {
          const bRes = await tx.query<{ business_date: string }>(
            `SELECT (((now() AT TIME ZONE $1) - $2::time)::date)::text as business_date`,
            [tenantInfo.timezone, tenantInfo.businessDayStartsAt],
          );
          const bRow = bRes.rows[0];
          if (!bRow) {
            throw new Error('Unable to compute current business date');
          }
          businessDate = bRow.business_date;
        }

        const dateRange = resolveDateRange(query.period, businessDate);
        const data = await this.reportingRepository.getDashboardSummary(
          tx,
          tenantInfo,
          dateRange.from,
          dateRange.to,
        );

        return {
          period: query.period,
          businessDate,
          dateRange,
          orders: data.orders,
          revenuePaise: data.revenuePaise,
          collectedPaise: data.collectedPaise,
          collectedByMethod: data.collectedByMethod,
          outstandingPaise: data.outstandingPaise,
          expensesPaise: data.expensesPaise,
          operatingResultPaise: data.operatingResultPaise,
          aovPaise: data.aovPaise,
          disclaimer: DISCLAIMER_TEXT,
        };
      },
    );
  }

  async getBreakdown(
    actor: ActingStaff,
    query: DashboardBreakdownQuery,
  ): Promise<DashboardBreakdown> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, actorKind: actor.actorKind },
      async (tx) => {
        const tenantInfo = await this.reportingRepository.getTenantContextInfo(
          tx,
          actor.tenantId,
        );

        let businessDate: string;
        if (query.date) {
          businessDate = query.date;
        } else {
          const bRes = await tx.query<{ business_date: string }>(
            `SELECT (((now() AT TIME ZONE $1) - $2::time)::date)::text as business_date`,
            [tenantInfo.timezone, tenantInfo.businessDayStartsAt],
          );
          const bRow = bRes.rows[0];
          if (!bRow) {
            throw new Error('Unable to compute current business date');
          }
          businessDate = bRow.business_date;
        }

        const dateRange = resolveDateRange(query.period, businessDate);
        const { items, totalPaise } = await this.reportingRepository.getBreakdown(
          tx,
          tenantInfo,
          dateRange.from,
          dateRange.to,
          query.by,
        );

        return {
          period: query.period,
          by: query.by,
          dateRange,
          items,
          totalPaise,
        };
      },
    );
  }
}

