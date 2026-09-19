import { Injectable } from '@nestjs/common';
import type {
  BreakdownItem,
  DashboardSummary,
} from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { toPaise } from '../../common/money/paise';

export interface TenantContextInfo {
  tenantId: string;
  timezone: string;
  businessDayStartsAt: string; // e.g. "04:00:00"
}

@Injectable()
export class ReportingRepository {
  /**
   * Fetch tenant timezone and business_day_starts_at settings
   */
  async getTenantContextInfo(
    tx: TransactionContext,
    tenantId: string,
  ): Promise<TenantContextInfo> {
    const res = await tx.query<{
      tenant_id: string;
      timezone: string;
      business_day_starts_at: string;
    }>(
      `SELECT t.id as tenant_id, t.timezone, coalesce(ts.business_day_starts_at::text, '04:00:00') as business_day_starts_at
         FROM tenant t
         LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId],
    );

    const row = res.rows[0];
    if (!row) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    return {
      tenantId: row.tenant_id,
      timezone: row.timezone || 'Asia/Kolkata',
      businessDayStartsAt: row.business_day_starts_at || '04:00:00',
    };
  }

  /**
   * Live, independent-CTE aggregated summary query.
   * Prevents any Cartesian product / fan-out inflation.
   */
  async getDashboardSummary(
    tx: TransactionContext,
    tenantInfo: TenantContextInfo,
    startDate: string, // YYYY-MM-DD
    endDate: string,   // YYYY-MM-DD
  ): Promise<Omit<DashboardSummary, 'period' | 'businessDate' | 'dateRange' | 'disclaimer'>> {
    const query = `
    WITH
    -- 1. Orders: completed vs cancelled
    orders_cte AS (
      SELECT
        count(*) FILTER (WHERE status = 'COMPLETED')::text as completed_count,
        count(*) FILTER (WHERE status = 'CANCELLED')::text as cancelled_count
      FROM orders
      WHERE tenant_id = $1
        AND (((placed_at AT TIME ZONE $2) - $3::time)::date >= $4::date)
        AND (((placed_at AT TIME ZONE $2) - $3::time)::date <= $5::date)
    ),
    -- 2. Finalized/Paid bills in this window: revenue = grand_total_paise
    bills_cte AS (
      SELECT
        coalesce(sum(grand_total_paise), 0)::text as revenue_paise,
        count(*)::text as bill_count
      FROM bill
      WHERE tenant_id = $1
        AND status IN ('FINALIZED', 'PAID')
        AND finalized_at IS NOT NULL
        AND (((finalized_at AT TIME ZONE $2) - $3::time)::date >= $4::date)
        AND (((finalized_at AT TIME ZONE $2) - $3::time)::date <= $5::date)
    ),
    -- 3. All-time outstanding paise across all non-settled finalized bills
    outstanding_cte AS (
      SELECT
        coalesce(sum(outstanding_paise), 0)::text as outstanding_paise
      FROM bill
      WHERE tenant_id = $1
        AND status = 'FINALIZED'
    ),
    -- 4. Payments received in this window
    payments_cte AS (
      SELECT
        coalesce(sum(amount_paise), 0)::text as collected_paise,
        coalesce(sum(amount_paise) FILTER (WHERE method = 'CASH'), 0)::text as cash_paise,
        coalesce(sum(amount_paise) FILTER (WHERE method = 'UPI_STATIC'), 0)::text as upi_paise
      FROM payment
      WHERE tenant_id = $1
        AND status = 'SUCCEEDED'
        AND (((received_at AT TIME ZONE $2) - $3::time)::date >= $4::date)
        AND (((received_at AT TIME ZONE $2) - $3::time)::date <= $5::date)
    ),
    -- 5. Expenses occurred in this window (based on expense_date)
    expenses_cte AS (
      SELECT
        coalesce(sum(amount_paise), 0)::text as expenses_paise
      FROM expense
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND expense_date >= $4::date
        AND expense_date <= $5::date
    )
    SELECT
      o.completed_count,
      o.cancelled_count,
      b.revenue_paise,
      b.bill_count,
      out.outstanding_paise,
      p.collected_paise,
      p.cash_paise,
      p.upi_paise,
      e.expenses_paise
    FROM orders_cte o
    CROSS JOIN bills_cte b
    CROSS JOIN outstanding_cte out
    CROSS JOIN payments_cte p
    CROSS JOIN expenses_cte e;
    `;

    const res = await tx.query<{
      completed_count: string;
      cancelled_count: string;
      revenue_paise: string;
      bill_count: string;
      outstanding_paise: string;
      collected_paise: string;
      cash_paise: string;
      upi_paise: string;
      expenses_paise: string;
    }>(query, [
      tenantInfo.tenantId,
      tenantInfo.timezone,
      tenantInfo.businessDayStartsAt,
      startDate,
      endDate,
    ]);

    const row = res.rows[0];
    const revenuePaise = toPaise(row?.revenue_paise ?? '0', 'revenue_paise');
    const collectedPaise = toPaise(row?.collected_paise ?? '0', 'collected_paise');
    const cashPaise = toPaise(row?.cash_paise ?? '0', 'cash_paise');
    const upiPaise = toPaise(row?.upi_paise ?? '0', 'upi_paise');
    const outstandingPaise = toPaise(row?.outstanding_paise ?? '0', 'outstanding_paise');
    const expensesPaise = toPaise(row?.expenses_paise ?? '0', 'expenses_paise');
    const operatingResultPaise = revenuePaise - expensesPaise; // Can be negative signed int!

    const completedOrders = Number(row?.completed_count ?? '0');
    const cancelledOrders = Number(row?.cancelled_count ?? '0');
    const billCount = Number(row?.bill_count ?? '0');

    // AOV = revenue / billCount (or 0 if no bills)
    const aovPaise = billCount > 0 ? Math.round(revenuePaise / billCount) : 0;

    return {
      orders: {
        completed: completedOrders,
        cancelled: cancelledOrders,
      },
      revenuePaise,
      collectedPaise,
      collectedByMethod: {
        cashPaise,
        upiPaise,
      },
      outstandingPaise,
      expensesPaise,
      operatingResultPaise,
      aovPaise,
    };
  }

  /**
   * Breakdowns by type, source, method, and expense_category
   */
  async getBreakdown(
    tx: TransactionContext,
    tenantInfo: TenantContextInfo,
    startDate: string,
    endDate: string,
    by: 'type' | 'source' | 'method' | 'expense_category',
  ): Promise<{ items: BreakdownItem[]; totalPaise: number }> {
    if (by === 'type') {
      // Order type breakdown: DINE_IN vs TAKEAWAY
      const res = await tx.query<{
        key: string;
        count: string;
        total_paise: string;
      }>(
        `SELECT
           type as key,
           count(*)::text as count,
           coalesce(sum(subtotal_paise), 0)::text as total_paise
         FROM orders
        WHERE tenant_id = $1
          AND status = 'COMPLETED'
          AND (((placed_at AT TIME ZONE $2) - $3::time)::date >= $4::date)
          AND (((placed_at AT TIME ZONE $2) - $3::time)::date <= $5::date)
        GROUP BY type
        ORDER BY total_paise DESC`,
        [tenantInfo.tenantId, tenantInfo.timezone, tenantInfo.businessDayStartsAt, startDate, endDate],
      );

      let totalPaise = 0;
      const items: BreakdownItem[] = res.rows.map((r) => {
        const itemPaise = toPaise(r.total_paise, 'breakdown_paise');
        totalPaise += itemPaise;
        return {
          key: r.key,
          label: r.key === 'DINE_IN' ? 'Dine In' : 'Takeaway',
          count: Number(r.count),
          totalPaise: itemPaise,
        };
      });
      return { items, totalPaise };
    }

    if (by === 'source') {
      // Order source breakdown: QR_DINE_IN vs COUNTER
      const res = await tx.query<{
        key: string;
        count: string;
        total_paise: string;
      }>(
        `SELECT
           source as key,
           count(*)::text as count,
           coalesce(sum(subtotal_paise), 0)::text as total_paise
         FROM orders
        WHERE tenant_id = $1
          AND status = 'COMPLETED'
          AND (((placed_at AT TIME ZONE $2) - $3::time)::date >= $4::date)
          AND (((placed_at AT TIME ZONE $2) - $3::time)::date <= $5::date)
        GROUP BY source
        ORDER BY total_paise DESC`,
        [tenantInfo.tenantId, tenantInfo.timezone, tenantInfo.businessDayStartsAt, startDate, endDate],
      );

      let totalPaise = 0;
      const items: BreakdownItem[] = res.rows.map((r) => {
        const itemPaise = toPaise(r.total_paise, 'breakdown_paise');
        totalPaise += itemPaise;
        return {
          key: r.key,
          label: r.key === 'QR_DINE_IN' ? 'QR Dine-in' : 'Counter',
          count: Number(r.count),
          totalPaise: itemPaise,
        };
      });
      return { items, totalPaise };
    }

    if (by === 'method') {
      // Payment method breakdown: CASH vs UPI_STATIC
      const res = await tx.query<{
        key: string;
        count: string;
        total_paise: string;
      }>(
        `SELECT
           method as key,
           count(*)::text as count,
           coalesce(sum(amount_paise), 0)::text as total_paise
         FROM payment
        WHERE tenant_id = $1
          AND status = 'SUCCEEDED'
          AND (((received_at AT TIME ZONE $2) - $3::time)::date >= $4::date)
          AND (((received_at AT TIME ZONE $2) - $3::time)::date <= $5::date)
        GROUP BY method
        ORDER BY total_paise DESC`,
        [tenantInfo.tenantId, tenantInfo.timezone, tenantInfo.businessDayStartsAt, startDate, endDate],
      );

      let totalPaise = 0;
      const items: BreakdownItem[] = res.rows.map((r) => {
        const itemPaise = toPaise(r.total_paise, 'breakdown_paise');
        totalPaise += itemPaise;
        return {
          key: r.key,
          label: r.key === 'UPI_STATIC' ? 'UPI' : 'Cash',
          count: Number(r.count),
          totalPaise: itemPaise,
        };
      });
      return { items, totalPaise };
    }

    if (by === 'expense_category') {
      // Expense category breakdown (LEFT JOIN to include historical soft-deleted categories)
      const res = await tx.query<{
        key: string;
        name: string | null;
        count: string;
        total_paise: string;
      }>(
        `SELECT
           e.category_id as key,
           c.name,
           count(*)::text as count,
           coalesce(sum(e.amount_paise), 0)::text as total_paise
         FROM expense e
         LEFT JOIN expense_category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
        WHERE e.tenant_id = $1
          AND e.deleted_at IS NULL
          AND e.expense_date >= $2::date
          AND e.expense_date <= $3::date
        GROUP BY e.category_id, c.name
        ORDER BY total_paise DESC`,
        [tenantInfo.tenantId, startDate, endDate],
      );

      let totalPaise = 0;
      const items: BreakdownItem[] = res.rows.map((r) => {
        const itemPaise = toPaise(r.total_paise, 'breakdown_paise');
        totalPaise += itemPaise;
        return {
          key: r.key,
          label: r.name ? r.name : 'Unknown Category',
          count: Number(r.count),
          totalPaise: itemPaise,
        };
      });
      return { items, totalPaise };
    }

    return { items: [], totalPaise: 0 };
  }
}

