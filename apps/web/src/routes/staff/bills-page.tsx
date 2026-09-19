import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BillStatus, BillSummary } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BillStatusBadge } from '@/features/billing/bill-status-badge';
import { formatBillNumber, formatPaise } from '@/features/billing/bill-format';
import { useBills } from '@/features/billing/use-bills';

const STATUS_TABS: Array<{ label: string; value: BillStatus | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Awaiting payment', value: 'FINALIZED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Void', value: 'VOID' },
  { label: 'Discarded', value: 'DISCARDED' },
];

export function BillsPage(): JSX.Element {
  const [status, setStatus] = useState<BillStatus | undefined>(undefined);
  const billsQuery = useBills(status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Bills</h1>
        <p className="text-sm text-muted-foreground">
          Create a bill from the Orders screen by selecting the orders of one table.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.label}
            size="sm"
            variant={status === tab.value ? 'default' : 'outline'}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bill list</CardTitle>
        </CardHeader>
        <CardContent>
          {billsQuery.isLoading && <p className="text-muted-foreground">Loading bills…</p>}
          {billsQuery.isError && (
            <div className="flex items-center gap-3">
              <p className="text-red-600">Could not load bills.</p>
              <Button size="sm" variant="outline" onClick={() => void billsQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {billsQuery.data && billsQuery.data.data.length === 0 && (
            <p className="text-muted-foreground">No bills yet.</p>
          )}
          {billsQuery.data && billsQuery.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Bill</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Total</th>
                    <th className="py-2 pr-4 text-right font-medium">Outstanding</th>
                    <th className="py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {billsQuery.data.data.map((bill: BillSummary) => (
                    <tr key={bill.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/app/bills/${bill.id}`}
                          className="text-primary-strong hover:underline"
                        >
                          {formatBillNumber(bill.billNumber)}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        <BillStatusBadge status={bill.status} />
                      </td>
                      <td className="py-2 pr-4 text-right font-tabular">
                        {formatPaise(bill.grandTotalPaise)}
                      </td>
                      <td className="py-2 pr-4 text-right font-tabular">
                        {formatPaise(bill.outstandingPaise)}
                      </td>
                      <td className="py-2">{new Date(bill.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
