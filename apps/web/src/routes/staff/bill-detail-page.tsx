import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Can } from '@/features/auth/can';
import { BillStatusBadge } from '@/features/billing/bill-status-badge';
import {
  describeBillError,
  formatBillNumber,
  formatPaise,
  isStaleBillError,
} from '@/features/billing/bill-format';
import { DiscountPanel } from '@/features/billing/discount-panel';
import { PaymentPanel } from '@/features/billing/payment-panel';
import {
  useBill,
  useBillPayments,
  useDiscardBill,
  useFinalizeBill,
  useVoidBill,
} from '@/features/billing/use-bills';

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-semibold' : 'text-sm'}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="font-tabular">{value}</span>
    </div>
  );
}

export function BillDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const billQuery = useBill(id as string);
  const paymentsQuery = useBillPayments(id as string);
  const finalize = useFinalizeBill(id as string);
  const discard = useDiscardBill(id as string);
  const voidBill = useVoidBill(id as string);
  const [error, setError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);

  if (billQuery.isLoading) return <p className="text-muted-foreground">Loading bill…</p>;
  if (billQuery.isError || !billQuery.data) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-red-600">Could not load this bill.</p>
        <Button size="sm" variant="outline" onClick={() => void billQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const bill = billQuery.data.data;
  const fail = (err: unknown): void => {
    setError(
      isStaleBillError(err)
        ? `${describeBillError(err)} The bill has been refreshed.`
        : describeBillError(err),
    );
  };

  const onFinalize = (): void => {
    setError(null);
    finalize.mutate(
      { expectedVersion: bill.version, expectedGrandTotalPaise: bill.grandTotalPaise },
      { onError: fail },
    );
  };
  const onDiscard = (): void => {
    setError(null);
    discard.mutate({ expectedVersion: bill.version }, { onError: fail });
  };
  const onVoid = (): void => {
    setError(null);
    voidBill.mutate(
      { expectedVersion: bill.version, reason: voidReason.trim() },
      {
        onSuccess: () => {
          setShowVoid(false);
          setVoidReason('');
        },
        onError: fail,
      },
    );
  };

  const orderCount = bill.orderIds.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/app/bills" className="text-sm text-muted-foreground hover:underline">
          ← Bills
        </Link>
        <h1 className="flex items-center gap-3 text-xl font-semibold">
          {formatBillNumber(bill.billNumber)} <BillStatusBadge status={bill.status} />
        </h1>
        <p className="text-sm text-muted-foreground">
          Covers {orderCount} order{orderCount === 1 ? '' : 's'}
          {bill.customerName ? ` · ${bill.customerName}` : ''}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 text-right font-medium">Qty</th>
                  <th className="py-2 pr-4 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">{line.description}</td>
                    <td className="py-2 pr-4 text-right font-tabular">{line.qty}</td>
                    <td className="py-2 pr-4 text-right font-tabular">
                      {formatPaise(line.unitPricePaise)}
                    </td>
                    <td className="py-2 text-right font-tabular">
                      {formatPaise(line.lineTotalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Row label="Subtotal" value={formatPaise(bill.subtotalPaise)} />
          {bill.discountPaise > 0 && (
            <Row label="Discount" value={`-${formatPaise(bill.discountPaise)}`} />
          )}
          {bill.roundingPaise !== 0 && (
            <Row label="Rounding" value={formatPaise(bill.roundingPaise)} />
          )}
          <div className="border-t border-border pt-2">
            <Row label="Grand total" value={formatPaise(bill.grandTotalPaise)} strong />
          </div>
          {(bill.status === 'FINALIZED' || bill.status === 'PAID') && (
            <>
              <Row label="Paid" value={formatPaise(bill.paidPaise)} />
              <Row label="Outstanding" value={formatPaise(bill.outstandingPaise)} />
            </>
          )}
          {bill.status === 'VOID' && bill.voidReason && (
            <p className="text-sm text-muted-foreground">Voided: {bill.voidReason}</p>
          )}
        </CardContent>
      </Card>

      {bill.status === 'DRAFT' && (
        <>
          <Can permission="bills.discount">
            <Card>
              <CardHeader>
                <CardTitle>Discount</CardTitle>
              </CardHeader>
              <CardContent>
                <DiscountPanel bill={bill} />
              </CardContent>
            </Card>
          </Can>
          <div className="flex flex-wrap gap-2">
            <Can permission="bills.finalize">
              <Button onClick={onFinalize} disabled={finalize.isPending}>
                {finalize.isPending ? 'Finalizing…' : 'Finalize bill'}
              </Button>
            </Can>
            <Can permission="bills.create">
              <Button variant="outline" onClick={onDiscard} disabled={discard.isPending}>
                Discard draft
              </Button>
            </Can>
          </div>
        </>
      )}

      {bill.status === 'FINALIZED' && (
        <>
          <Can permission="payments.record">
            <Card>
              <CardHeader>
                <CardTitle>Record payment</CardTitle>
              </CardHeader>
              <CardContent>
                <PaymentPanel bill={bill} />
              </CardContent>
            </Card>
          </Can>
          <Can permission="bills.void">
            <div className="flex flex-col gap-2">
              <div>
                <Button variant="outline" onClick={() => setShowVoid((v) => !v)}>
                  Void bill
                </Button>
              </div>
              {showVoid && (
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor="void-reason">Reason for voiding</Label>
                    <Input
                      id="void-reason"
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                    />
                  </div>
                  <Button onClick={onVoid} disabled={voidBill.isPending || !voidReason.trim()}>
                    Confirm void
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Voiding releases the orders so they can be edited and billed again.
              </p>
            </div>
          </Can>
        </>
      )}

      <Can permission="payments.read">
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentsQuery.data && paymentsQuery.data.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No payments recorded.</p>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {(paymentsQuery.data?.data ?? []).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between border-b border-border py-1 last:border-0"
                >
                  <span>
                    {p.method === 'CASH' ? 'Cash' : 'UPI'}
                    {p.providerReference ? ` · ${p.providerReference}` : ''}
                    {p.referenceNote ? ` · ${p.referenceNote}` : ''}
                  </span>
                  <span className="font-tabular">
                    {formatPaise(p.amountPaise)}{' '}
                    <span className="text-muted-foreground">
                      {new Date(p.receivedAt).toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Can>
    </div>
  );
}
