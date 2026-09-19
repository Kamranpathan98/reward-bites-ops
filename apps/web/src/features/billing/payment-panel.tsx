import { useRef, useState } from 'react';
import type { BillDetail, PaymentMethod } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { describeBillError, formatPaise } from './bill-format';
import { useRecordPayment } from './use-bills';

/**
 * V1 full settlement of a FINALIZED bill. The amount is fixed to the
 * outstanding balance (partial payments are not supported) and there is no
 * cash-tendered / change field: giving change happens at the counter.
 *
 * Idempotency: one key per logical request. The key is reused only for a retry
 * of the IDENTICAL body (lost response, double click); editing any field starts a
 * new request with a new key, otherwise the server would answer IDEMPOTENT_MISMATCH.
 */
export function PaymentPanel({ bill }: { bill: BillDetail }): JSX.Element {
  const record = useRecordPayment(bill.id);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const submit = (): void => {
    setError(null);
    const fingerprint = JSON.stringify([
      bill.id,
      bill.version,
      method,
      bill.outstandingPaise,
      method === 'UPI_STATIC' ? reference.trim() : '',
      note.trim(),
    ]);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    record.mutate(
      {
        idempotencyKey: attempt.current.key,
        billId: bill.id,
        method,
        amountPaise: bill.outstandingPaise,
        expectedBillVersion: bill.version,
        ...(method === 'UPI_STATIC' && reference.trim()
          ? { providerReference: reference.trim() }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      { onError: (err) => setError(describeBillError(err)) },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Record the full outstanding amount of{' '}
        <strong className="font-tabular text-foreground">
          {formatPaise(bill.outstandingPaise)}
        </strong>
        . Partial payments are not supported.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-method">Method</Label>
          <Select
            id="payment-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            <option value="CASH">Cash</option>
            <option value="UPI_STATIC">UPI</option>
          </Select>
        </div>
        {method === 'UPI_STATIC' && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="payment-reference">UPI reference (UTR, 12 digits)</Label>
            <Input
              id="payment-reference"
              inputMode="numeric"
              maxLength={12}
              className="w-48"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="payment-note">Note (optional)</Label>
          <Input
            id="payment-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
          />
        </div>
        <Button onClick={submit} disabled={record.isPending}>
          {record.isPending ? 'Recording…' : `Record ${formatPaise(bill.outstandingPaise)}`}
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
