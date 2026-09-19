import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OrderStatus, OrderTransitionTarget } from '@rewardbite/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { Can } from '@/features/auth/can';
import {
  useCancelOrder,
  useEditOrderLines,
  useOrder,
  useReopenOrder,
  useTransitionOrder,
} from '@/features/orders/use-orders';

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

// The frontend never pre-filters by tenant workflow mode (no `/settings`
// read exists yet) — every status-plausible next step is offered, and the
// backend is the actual authority; a disallowed shortcut comes back as a
// normal 409 the screen surfaces like any other mutation error.
const NEXT_STEPS: Partial<Record<OrderStatus, OrderTransitionTarget[]>> = {
  NEW: ['ACCEPTED', 'COMPLETED'],
  ACCEPTED: ['PREPARING', 'COMPLETED'],
  PREPARING: ['READY'],
  READY: ['COMPLETED'],
};

const TRANSITION_PERMISSION: Record<
  OrderTransitionTarget,
  'orders.transition.front' | 'orders.transition.kitchen'
> = {
  ACCEPTED: 'orders.transition.front',
  PREPARING: 'orders.transition.kitchen',
  READY: 'orders.transition.kitchen',
  COMPLETED: 'orders.transition.front',
};

const CANCELLABLE: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY'];

export function OrderDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const orderQuery = useOrder(id as string);
  const transition = useTransitionOrder();
  const cancel = useCancelOrder();
  const reopen = useReopenOrder();
  const editLines = useEditOrderLines();
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);

  if (orderQuery.isLoading) return <p className="text-muted-foreground">Loading order…</p>;
  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-red-600">Could not load this order.</p>
        <Button size="sm" variant="outline" onClick={() => void orderQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const order = orderQuery.data.data;
  // Once a bill is FINALIZED the order is frozen (server: ORDER_ALREADY_BILLED);
  // disable the controls instead of letting staff hit the 422.
  const isBilled = order.billId !== null;

  const handleTransition = (to: OrderTransitionTarget): void => {
    setError(null);
    transition.mutate(
      { id: order.id, to, expectedVersion: order.version },
      { onError: (err) => setError(describeError(err)) },
    );
  };

  const handleCancel = (): void => {
    setError(null);
    cancel.mutate(
      { id: order.id, expectedVersion: order.version, reason: cancelReason },
      {
        onSuccess: () => {
          setShowCancelForm(false);
          setCancelReason('');
        },
        onError: (err) => setError(describeError(err)),
      },
    );
  };

  const handleReopen = (): void => {
    setError(null);
    reopen.mutate(
      { id: order.id, expectedVersion: order.version },
      { onError: (err) => setError(describeError(err)) },
    );
  };

  const handleRemoveLine = (lineId: string): void => {
    setError(null);
    editLines.mutate(
      { id: order.id, expectedVersion: order.version, remove: [lineId] },
      { onError: (err) => setError(describeError(err)) },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/app/orders" className="text-sm text-muted-foreground hover:underline">
            ← Orders
          </Link>
          <h1 className="text-xl font-semibold">
            {order.orderNumber} <Badge>{order.status}</Badge>
          </h1>
        </div>
      </div>

      {isBilled && (
        <p className="rounded-md border border-border bg-muted p-3 text-sm">
          This order is on a bill and can no longer be changed.{' '}
          <Link to={`/app/bills/${order.billId}`} className="text-primary-strong hover:underline">
            View bill
          </Link>
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {order.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between border-b border-border py-2 last:border-0"
            >
              <div>
                <span
                  className={line.status === 'REMOVED' ? 'text-muted-foreground line-through' : ''}
                >
                  {line.qty} × {line.itemNameSnapshot}
                  {line.variantNameSnapshot ? ` (${line.variantNameSnapshot})` : ''}
                </span>
                {line.addons.length > 0 && (
                  <ul className="ml-4 text-xs text-muted-foreground">
                    {line.addons.map((addon) => (
                      <li key={addon.addonId}>
                        + {addon.qty} × {addon.nameSnapshot} ({formatPaise(addon.unitPricePaise)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span>{formatPaise(line.lineTotalPaise)}</span>
                <Can permission="orders.update">
                  {line.status === 'ACTIVE' &&
                    !isBilled &&
                    (order.status === 'NEW' || order.status === 'ACCEPTED') && (
                      <Button size="sm" variant="outline" onClick={() => handleRemoveLine(line.id)}>
                        Remove
                      </Button>
                    )}
                </Can>
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-2 font-medium">
            <span>Subtotal ({order.lineCount} lines)</span>
            <span>{formatPaise(order.subtotalPaise)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {(NEXT_STEPS[order.status] ?? []).map((to) => (
            <Can key={to} permission={TRANSITION_PERMISSION[to]}>
              <Button
                size="sm"
                onClick={() => handleTransition(to)}
                disabled={transition.isPending}
              >
                Mark {to.toLowerCase()}
              </Button>
            </Can>
          ))}

          {CANCELLABLE.includes(order.status) && !isBilled && (
            <Can permission="orders.cancel">
              <Button size="sm" variant="outline" onClick={() => setShowCancelForm((v) => !v)}>
                Cancel order
              </Button>
            </Can>
          )}

          {order.status === 'COMPLETED' && !isBilled && (
            <Can permission="orders.reopen">
              <Button
                size="sm"
                variant="outline"
                onClick={handleReopen}
                disabled={reopen.isPending}
              >
                Reopen
              </Button>
            </Can>
          )}
        </CardContent>
        {showCancelForm && (
          <CardContent className="flex items-end gap-2 border-t border-border pt-4">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="cancel-reason" className="text-sm font-medium">
                Cancellation reason
              </label>
              <Input
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              onClick={handleCancel}
              disabled={cancel.isPending || !cancelReason.trim()}
            >
              Confirm cancel
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm">
            {order.history.map((entry, i) => (
              <li
                key={i}
                className="flex items-center justify-between border-b border-border py-1 last:border-0"
              >
                <span>
                  {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                  {entry.toStatus}
                  {entry.reason ? ` — ${entry.reason}` : ''}
                </span>
                <span className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
