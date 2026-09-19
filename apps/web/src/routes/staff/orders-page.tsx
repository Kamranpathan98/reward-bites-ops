import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import {
  createOrderRequestSchema,
  type CreateOrderRequest,
  type OrderStatus,
  type OrderSummary,
} from '@rewardbite/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { Can } from '@/features/auth/can';
import { describeBillError } from '@/features/billing/bill-format';
import { useCreateBill } from '@/features/billing/use-bills';
import { useMenu } from '@/features/menu/use-menu';
import { useCreateOrder, useOrders } from '@/features/orders/use-orders';
import { useTables } from '@/features/tables/use-tables';

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

const STATUS_TABS: Array<{ label: string; value: OrderStatus | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'New', value: 'NEW' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Preparing', value: 'PREPARING' },
  { label: 'Ready', value: 'READY' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

export function OrdersPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(undefined);
  const ordersQuery = useOrders(statusFilter ? { status: [statusFilter] } : undefined);
  const navigate = useNavigate();
  const createBill = useCreateBill();
  const [selected, setSelected] = useState<string[]>([]);
  const [billError, setBillError] = useState<string | null>(null);

  const orders = ordersQuery.data?.data ?? [];
  const isBillable = (o: OrderSummary): boolean => o.status !== 'CANCELLED' && o.billId === null;
  // A bill covers one table session, so selection is locked to the session of
  // the first ticked order.
  const selectedOrders = orders.filter((o) => selected.includes(o.id));
  const activeSessionId = selectedOrders[0]?.tableSessionId;

  const toggle = (id: string): void =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const handleCreateBill = (): void => {
    if (!activeSessionId || selectedOrders.length === 0) return;
    setBillError(null);
    createBill.mutate(
      {
        idempotencyKey: crypto.randomUUID(),
        sessionId: activeSessionId,
        orderIds: selectedOrders.map((o) => o.id),
      },
      {
        onSuccess: (res) => {
          setSelected([]);
          navigate(`/app/bills/${res.data.id}`);
        },
        onError: (err) => setBillError(describeBillError(err)),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Orders</h1>

      <Can permission="orders.create">
        <CreateOrderForm />
      </Can>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.label}
            size="sm"
            variant={statusFilter === tab.value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order list</CardTitle>
        </CardHeader>
        <CardContent>
          {ordersQuery.isLoading && <p className="text-muted-foreground">Loading orders…</p>}
          {ordersQuery.isError && (
            <div className="flex items-center gap-3">
              <p className="text-red-600">Could not load orders.</p>
              <Button size="sm" variant="outline" onClick={() => void ordersQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {ordersQuery.data && ordersQuery.data.data.length === 0 && (
            <p className="text-muted-foreground">No orders yet.</p>
          )}
          {ordersQuery.data && ordersQuery.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <Can permission="bills.create">
                      <th className="w-8 py-2 pr-2 font-medium">
                        <span className="sr-only">Select for bill</span>
                      </th>
                    </Can>
                    <th className="py-2 pr-4 font-medium">Order #</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Subtotal</th>
                    <th className="py-2 pr-4 font-medium">Billing</th>
                    <th className="py-2 pr-4 font-medium">Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersQuery.data.data.map((order: OrderSummary) => (
                    <tr key={order.id} className="border-b border-border last:border-0">
                      <Can permission="bills.create">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Select order ${order.orderNumber} for billing`}
                            checked={selected.includes(order.id)}
                            disabled={
                              !isBillable(order) ||
                              (activeSessionId !== undefined &&
                                order.tableSessionId !== activeSessionId)
                            }
                            onChange={() => toggle(order.id)}
                          />
                        </td>
                      </Can>
                      <td className="py-2 pr-4">
                        <Link
                          to={`/app/orders/${order.id}`}
                          className="text-primary-strong hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{order.type}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={order.status === 'CANCELLED' ? 'secondary' : 'default'}>
                          {order.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">{formatPaise(order.subtotalPaise)}</td>
                      <td className="py-2 pr-4">
                        {order.billId ? (
                          <Link
                            to={`/app/bills/${order.billId}`}
                            className="text-primary-strong hover:underline"
                          >
                            Billed
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">{new Date(order.placedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Can permission="bills.create">
            {selected.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={handleCreateBill} disabled={createBill.isPending}>
                  {createBill.isPending
                    ? 'Creating…'
                    : `Create bill from ${selected.length} order${selected.length === 1 ? '' : 's'}`}
                </Button>
                <Button variant="outline" onClick={() => setSelected([])}>
                  Clear selection
                </Button>
                {billError && (
                  <p role="alert" className="text-sm text-red-600">
                    {billError}
                  </p>
                )}
              </div>
            )}
          </Can>
        </CardContent>
      </Card>
    </div>
  );
}

interface LineFormValue {
  itemId: string;
  variantId: string;
  qty: number;
}

function CreateOrderForm(): JSX.Element {
  const menuQuery = useMenu();
  const tablesQuery = useTables();
  const createOrder = useCreateOrder();
  const [type, setType] = useState<'DINE_IN' | 'TAKEAWAY'>('DINE_IN');

  const { register, control, handleSubmit, reset, watch } = useForm<{
    tableId: string;
    customerName: string;
    lines: LineFormValue[];
  }>({
    defaultValues: {
      tableId: '',
      customerName: '',
      lines: [{ itemId: '', variantId: '', qty: 1 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const [formError, setFormError] = useState<string | null>(null);

  const items = menuQuery.data?.data.categories.flatMap((c) => c.items) ?? [];

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    const body: CreateOrderRequest = {
      idempotencyKey: crypto.randomUUID(),
      type,
      ...(type === 'DINE_IN' ? { tableId: values.tableId } : {}),
      ...(values.customerName ? { customerName: values.customerName } : {}),
      lines: values.lines
        .filter((l) => l.itemId)
        .map((l) => ({
          itemId: l.itemId,
          ...(l.variantId ? { variantId: l.variantId } : {}),
          qty: Number(l.qty),
        })),
    };
    const parsed = createOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'This order is not valid.');
      return;
    }
    createOrder.mutate(parsed.data, {
      onSuccess: () =>
        reset({ tableId: '', customerName: '', lines: [{ itemId: '', variantId: '', qty: 1 }] }),
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New order</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="order-type">Type</Label>
              <Select
                id="order-type"
                value={type}
                onChange={(e) => setType(e.target.value as 'DINE_IN' | 'TAKEAWAY')}
              >
                <option value="DINE_IN">Dine-in</option>
                <option value="TAKEAWAY">Takeaway</option>
              </Select>
            </div>
            {type === 'DINE_IN' && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="order-table">Table</Label>
                <Select id="order-table" {...register('tableId')}>
                  <option value="">Select a table…</option>
                  {(tablesQuery.data?.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="order-customer">Customer name</Label>
              <Input id="order-customer" {...register('customerName')} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {fields.map((field, index) => {
              const selectedItemId = watch(`lines.${index}.itemId`);
              const selectedItem = items.find((i) => i.id === selectedItemId);
              const variants = selectedItem?.variants ?? [];
              return (
                <div
                  key={field.id}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
                >
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`line-item-${index}`}>Item</Label>
                    <Select
                      id={`line-item-${index}`}
                      {...register(`lines.${index}.itemId` as const)}
                    >
                      <option value="">Select an item…</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.basePricePaise !== null
                            ? ` — ${formatPaise(item.basePricePaise)}`
                            : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {variants.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`line-variant-${index}`}>Variant</Label>
                      <Select
                        id={`line-variant-${index}`}
                        {...register(`lines.${index}.variantId` as const)}
                      >
                        <option value="">Select a variant…</option>
                        {variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.name} — {formatPaise(variant.pricePaise)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`line-qty-${index}`}>Qty</Label>
                    <Input
                      id={`line-qty-${index}`}
                      type="number"
                      min={1}
                      className="w-20"
                      {...register(`lines.${index}.qty` as const, { valueAsNumber: true })}
                    />
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => remove(index)}>
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => append({ itemId: '', variantId: '', qty: 1 })}
            >
              Add line
            </Button>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {createOrder.error && (
            <p role="alert" className="text-sm text-red-600">
              {describeError(createOrder.error)}
            </p>
          )}

          <div>
            <Button type="submit" disabled={createOrder.isPending}>
              {createOrder.isPending ? 'Placing…' : 'Place order'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
