import * as React from 'react';
import { cn } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import { Button } from './button';

export interface BillLineItem {
  name: string;
  quantity: number;
  unitPrice: string | number;
  totalPrice: string | number;
}

export interface TaxLine {
  name: string;
  percent?: string | number;
  amount: string | number;
}

export interface BillSummaryProps extends React.HTMLAttributes<HTMLDivElement> {
  invoiceNumber?: string;
  tableLabel?: string;
  items?: BillLineItem[];
  subtotal: string | number;
  taxes?: TaxLine[];
  discounts?: Array<{ name: string; amount: string | number }>;
  serviceCharge?: string | number;
  grandTotal: string | number;
  paymentStatus?: 'PAID' | 'PENDING';
  paymentMethod?: string;
  onSettle?: () => void;
  settleLabel?: string;
  /**
   * Element used for the bill title. Defaults to `h4` (the original product
   * behavior); pages that own their heading outline (e.g. marketing) pass `p`
   * or the level that fits their hierarchy.
   */
  titleAs?: 'h2' | 'h3' | 'h4' | 'p';
}

export function BillSummary({
  invoiceNumber,
  tableLabel,
  items = [],
  subtotal,
  taxes = [],
  discounts = [],
  serviceCharge,
  grandTotal,
  paymentStatus,
  paymentMethod,
  onSettle,
  settleLabel = 'Settle Bill',
  titleAs: TitleTag = 'h4',
  className,
  ...props
}: BillSummaryProps): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4',
        className,
      )}
      {...props}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-3">
        <div>
          <TitleTag className="font-bold text-base text-foreground tracking-tight">
            {invoiceNumber ? `Bill ${invoiceNumber}` : 'Bill Summary'}
          </TitleTag>
          {tableLabel && <span className="text-xs text-muted-foreground">{tableLabel}</span>}
        </div>
        {paymentStatus && <StatusBadge status={paymentStatus} size="sm" />}
      </div>

      {/* Itemized Table */}
      <div className="flex flex-col gap-2 border-b border-border-subtle pb-3 text-xs">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-baseline justify-between gap-2">
            <span className="text-foreground min-w-0 truncate">
              <span className="font-bold font-tabular text-primary-strong mr-1">
                {item.quantity}×
              </span>
              {item.name}
            </span>
            <span className="font-tabular font-medium text-foreground shrink-0">
              {item.totalPrice}
            </span>
          </div>
        ))}
      </div>

      {/* Financial Calculations Breakdown */}
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground border-b border-border-subtle pb-3 font-tabular">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="font-semibold text-foreground">{subtotal}</span>
        </div>

        {discounts.map((discount, idx) => (
          <div key={idx} className="flex justify-between text-emerald-700">
            <span>Discount ({discount.name})</span>
            <span>-{discount.amount}</span>
          </div>
        ))}

        {taxes.map((tax, idx) => (
          <div key={idx} className="flex justify-between">
            <span>
              {tax.name} {tax.percent ? `(${tax.percent}%)` : ''}
            </span>
            <span>{tax.amount}</span>
          </div>
        ))}

        {serviceCharge && (
          <div className="flex justify-between">
            <span>Service Charge</span>
            <span>{serviceCharge}</span>
          </div>
        )}
      </div>

      {/* Grand Total */}
      <div className="flex items-baseline justify-between pt-1 font-tabular">
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Grand Total
          </span>
          {paymentMethod && (
            <span className="text-caption text-muted-foreground">Method: {paymentMethod}</span>
          )}
        </div>
        <span className="text-2xl font-black text-foreground tracking-tight">{grandTotal}</span>
      </div>

      {/* Settle Action */}
      {onSettle && paymentStatus !== 'PAID' && (
        <Button
          type="button"
          variant="default"
          size="touch"
          onClick={onSettle}
          className="w-full font-bold shadow-sm"
        >
          {settleLabel}
        </Button>
      )}
    </div>
  );
}
