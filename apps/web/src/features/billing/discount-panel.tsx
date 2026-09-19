import { useState } from 'react';
import type { BillDetail } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { describeBillError, formatPaise, percentToBasisPoints, rupeesToPaise } from './bill-format';
import { useApplyDiscount } from './use-bills';

/**
 * DRAFT-only. One discount per bill: applying a second one replaces the first,
 * "Remove discount" deletes it. The server enforces the tenant cap
 * (DISCOUNT_EXCEEDS_CAP) and shows its own message.
 */
export function DiscountPanel({ bill }: { bill: BillDetail }): JSX.Element {
  const apply = useApplyDiscount(bill.id);
  const current = bill.adjustments[0];
  const [kind, setKind] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    const parsed = kind === 'PERCENT' ? percentToBasisPoints(value) : rupeesToPaise(value);
    if (parsed === null || parsed <= 0) {
      setError(
        kind === 'PERCENT'
          ? 'Enter a percentage greater than 0, with up to 2 decimals.'
          : 'Enter an amount greater than 0, with up to 2 decimals.',
      );
      return;
    }
    apply.mutate(
      {
        expectedVersion: bill.version,
        discount: { kind, value: parsed, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      },
      {
        onSuccess: () => {
          setValue('');
          setReason('');
        },
        onError: (err) => setError(describeBillError(err)),
      },
    );
  };

  const remove = (): void => {
    setError(null);
    apply.mutate(
      { expectedVersion: bill.version, discount: null },
      { onError: (err) => setError(describeBillError(err)) },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {current && (
        <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
          <span>
            {current.label}: {formatPaise(current.amountPaise)}
            {current.reason ? ` — ${current.reason}` : ''}
          </span>
          <Button size="sm" variant="outline" onClick={remove} disabled={apply.isPending}>
            Remove discount
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="discount-kind">Discount type</Label>
          <Select
            id="discount-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'PERCENT' | 'FIXED')}
          >
            <option value="PERCENT">Percent (%)</option>
            <option value="FIXED">Fixed amount (₹)</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="discount-value">{kind === 'PERCENT' ? 'Percent' : 'Amount (₹)'}</Label>
          <Input
            id="discount-value"
            inputMode="decimal"
            className="w-28"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="discount-reason">Reason (optional)</Label>
          <Input
            id="discount-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={255}
          />
        </div>
        <Button size="sm" onClick={submit} disabled={apply.isPending}>
          {current ? 'Replace discount' : 'Apply discount'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
