import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPaise } from '@/features/billing/bill-format';
import { useDashboardBreakdown, useDashboardSummary } from '@/features/dashboard/use-dashboard';

export function DashboardPage(): JSX.Element {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [breakdownBy, setBreakdownBy] = useState<'type' | 'source' | 'method' | 'expense_category'>('method');

  const summaryQuery = useDashboardSummary({ period });
  const breakdownQuery = useDashboardBreakdown({ period, by: breakdownBy });

  const summary = summaryQuery.data?.data;
  const breakdown = breakdownQuery.data?.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Business Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Operational snapshot, revenue collection, and expense performance.
          </p>
        </div>

        {/* Period Selector Tabs */}
        <div className="flex bg-muted/60 p-1 rounded-lg">
          {(['today', 'week', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors capitalize ${
                period === p
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {summaryQuery.isLoading && <p className="text-muted-foreground">Loading dashboard summary…</p>}
      {summaryQuery.isError && (
        <div className="flex items-center gap-3">
          <p className="text-red-600">Could not load dashboard data.</p>
          <Button size="sm" variant="outline" onClick={() => void summaryQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {summary && (
        <>
          {/* Business Date info */}
          <div className="text-xs text-muted-foreground flex items-center justify-between border-b border-border pb-2">
            <span>
              Business Date: <strong className="text-foreground">{summary.businessDate}</strong> (
              {summary.dateRange.from} to {summary.dateRange.to})
            </span>
            <span>Refreshes live automatically</span>
          </div>

          {/* 6 Key Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* 1. Revenue */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Revenue (Billed)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {formatPaise(summary.revenuePaise)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  AOV: {formatPaise(summary.aovPaise)} per finalized bill
                </p>
              </CardContent>
            </Card>

            {/* 2. Collected */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Collected Payments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600">
                  {formatPaise(summary.collectedPaise)}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                  <span>Cash: {formatPaise(summary.collectedByMethod.cashPaise)}</span>
                  <span>UPI: {formatPaise(summary.collectedByMethod.upiPaise)}</span>
                </div>
              </CardContent>
            </Card>

            {/* 3. Outstanding */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Outstanding (All-Time)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">
                  {formatPaise(summary.outstandingPaise)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Unsettled across all dates</p>
              </CardContent>
            </Card>

            {/* 4. Expenses */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Expenses
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatPaise(summary.expensesPaise)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Recorded in this period</p>
              </CardContent>
            </Card>

            {/* 5. Operating Result */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Operating Result
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    summary.operatingResultPaise >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {formatPaise(summary.operatingResultPaise)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Revenue minus Expenses</p>
              </CardContent>
            </Card>

            {/* 6. Orders Count */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Orders Completed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {summary.orders.completed}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Cancelled: {summary.orders.cancelled}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Disclaimer Footnote */}
          <div className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded border border-border/50">
            ℹ️ {summary.disclaimer}
          </div>

          {/* Breakdowns Section */}
          <Card className="mt-2">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-base">Breakdown Analysis</CardTitle>
              <div className="flex gap-2">
                {(
                  [
                    { label: 'Payment Method', value: 'method' },
                    { label: 'Order Type', value: 'type' },
                    { label: 'Order Source', value: 'source' },
                    { label: 'Expense Category', value: 'expense_category' },
                  ] as const
                ).map((b) => (
                  <Button
                    key={b.value}
                    size="sm"
                    variant={breakdownBy === b.value ? 'default' : 'outline'}
                    onClick={() => setBreakdownBy(b.value)}
                  >
                    {b.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {breakdownQuery.isLoading && (
                <p className="text-muted-foreground">Loading breakdown data…</p>
              )}
              {breakdownQuery.isError && (
                <p className="text-red-600">Could not load breakdown data.</p>
              )}
              {breakdown && breakdown.items.length === 0 && (
                <p className="text-muted-foreground">No data for this breakdown in this period.</p>
              )}
              {breakdown && breakdown.items.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Dimension</th>
                        <th className="py-2 pr-4 font-medium text-right">Count</th>
                        <th className="py-2 pl-4 font-medium text-right">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.items.map((item) => (
                        <tr key={item.key} className="border-b border-border/50">
                          <td className="py-2 pr-4 font-medium">{item.label}</td>
                          <td className="py-2 pr-4 text-right">{item.count}</td>
                          <td className="py-2 pl-4 text-right font-medium">
                            {formatPaise(item.totalPaise)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border font-semibold">
                        <td className="py-2 pr-4">Total</td>
                        <td className="py-2 pr-4 text-right">
                          {breakdown.items.reduce((acc, cur) => acc + cur.count, 0)}
                        </td>
                        <td className="py-2 pl-4 text-right text-foreground">
                          {formatPaise(breakdown.totalPaise)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

