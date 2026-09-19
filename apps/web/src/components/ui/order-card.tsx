import * as React from 'react';
import { cn } from '@/lib/utils';
import { StatusBadge, type OperationalStatus } from './status-badge';

export interface OrderItemSummary {
  name: string;
  quantity: number;
  notes?: string;
}

export interface OrderCardProps extends React.HTMLAttributes<HTMLDivElement> {
  orderNumber: string;
  tableLabel?: string;
  source?: string;
  status: OperationalStatus | string;
  elapsedTime?: string;
  itemCount: number;
  itemsSummary?: OrderItemSummary[];
  totalAmount: string | number;
  actions?: React.ReactNode;
}

export function OrderCard({
  orderNumber,
  tableLabel,
  source = 'Dine-in',
  status,
  elapsedTime,
  itemCount,
  itemsSummary = [],
  totalAmount,
  actions,
  className,
  ...props
}: OrderCardProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-lg border border-border bg-surface p-4 shadow-sm transition-all hover:border-border-strong hover:shadow-card gap-3',
        className,
      )}
      {...props}
    >
      {/* Header: Order ID + Status Badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold font-tabular text-foreground tracking-tight">
            {orderNumber}
          </span>
          {tableLabel && (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-semibold text-secondary truncate">
              {tableLabel}
            </span>
          )}
        </div>
        <StatusBadge status={status} size="sm" />
      </div>

      {/* Meta Bar: Source & Elapsed Time */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border-subtle pb-2">
        <span className="font-medium">{source}</span>
        {elapsedTime && (
          <span className="inline-flex items-center gap-1 font-tabular">
            <svg
              className="w-3 h-3 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {elapsedTime}
          </span>
        )}
      </div>

      {/* Item Lines */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="text-xs font-medium text-muted-foreground">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
        {itemsSummary.length > 0 && (
          <div className="flex flex-col gap-1 text-xs">
            {itemsSummary.slice(0, 3).map((item, idx) => (
              <div key={idx} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-foreground">
                  <span className="font-semibold font-tabular text-primary-strong mr-1">
                    {item.quantity}×
                  </span>
                  {item.name}
                </span>
                {item.notes && (
                  <span className="text-caption text-muted-foreground italic truncate max-w-[120px]">
                    {item.notes}
                  </span>
                )}
              </div>
            ))}
            {itemsSummary.length > 3 && (
              <span className="text-caption text-muted-foreground italic">
                +{itemsSummary.length - 3} more items…
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: Total Amount & Action Buttons */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle mt-1">
        <div className="flex flex-col">
          <span className="text-caption uppercase font-semibold text-muted-foreground tracking-wider">
            Total
          </span>
          <span className="text-base font-bold font-tabular text-foreground">{totalAmount}</span>
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
