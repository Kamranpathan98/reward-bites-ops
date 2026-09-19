import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type TableOccupancyState = 'AVAILABLE' | 'OCCUPIED' | 'BILL_REQUESTED' | 'RESERVED';

export interface TableStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  tableNumber: string;
  capacity: string | number;
  state: TableOccupancyState;
  elapsedTime?: string;
  guestCount?: number;
  currentBill?: string | number;
  orderNumber?: string;
  onAction?: () => void;
  actionLabel?: string;
}

export function TableStatus({
  tableNumber,
  capacity,
  state,
  elapsedTime,
  guestCount,
  currentBill,
  orderNumber,
  onAction,
  actionLabel,
  className,
  ...props
}: TableStatusProps): JSX.Element {
  const stateMap: Record<string, 'AVAILABLE' | 'OCCUPIED' | 'BILL_REQUESTED' | 'RESERVED'> = {
    AVAILABLE: 'AVAILABLE',
    OCCUPIED: 'OCCUPIED',
    BILL_REQUESTED: 'BILL_REQUESTED',
    BILLING: 'BILL_REQUESTED',
    RESERVED: 'RESERVED',
  };

  const rawState = (state || (props as Record<string, unknown>)['status'] || 'AVAILABLE') as string;
  const resolvedState = stateMap[rawState.toUpperCase()] || 'AVAILABLE';

  const stateConfigMap = {
    AVAILABLE: {
      label: 'Available',
      badgeClass: 'bg-surface-muted text-muted-foreground border-border',
      dotClass: 'bg-slate-300',
      borderClass: 'border-border',
      activeBillHighlight: false,
    },
    OCCUPIED: {
      label: 'Occupied',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      dotClass: 'bg-emerald-500',
      borderClass: 'border-emerald-200 hover:border-emerald-300',
      activeBillHighlight: false,
    },
    BILL_REQUESTED: {
      label: 'Bill Requested',
      badgeClass: 'bg-primary-strong text-primary-foreground border-primary-strong',
      dotClass: 'bg-white',
      borderClass: 'border-primary ring-1 ring-primary/20 shadow-md',
      activeBillHighlight: true,
    },
    RESERVED: {
      label: 'Reserved',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      dotClass: 'bg-amber-500',
      borderClass: 'border-amber-200',
      activeBillHighlight: false,
    },
  };

  const stateConfig = stateConfigMap[resolvedState];

  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between rounded-xl border bg-surface p-4 shadow-sm transition-all hover:shadow-card gap-3',
        stateConfig.borderClass,
        className,
      )}
      {...props}
    >
      {/* Top: Table No & Status Pill */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black font-tabular text-foreground tracking-tight">
            {tableNumber}
          </span>
          <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {typeof capacity === 'number' ? `${capacity} Pax` : capacity}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold font-tabular border select-none',
            stateConfig.badgeClass,
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', stateConfig.dotClass)} />
          <span>{stateConfig.label}</span>
        </span>
      </div>

      {/* Middle: Session Details */}
      {state === 'AVAILABLE' ? (
        <div className="py-4 text-center text-xs text-muted-foreground bg-surface-subtle rounded border border-dashed border-border-subtle">
          Table ready for guests
        </div>
      ) : (
        <div
          className={cn(
            'p-3 rounded-lg flex flex-col gap-1.5 text-xs',
            stateConfig.activeBillHighlight
              ? 'bg-orange-50 border border-orange-200'
              : 'bg-surface-muted',
          )}
        >
          <div className="flex items-center justify-between text-muted-foreground">
            {elapsedTime && (
              <span className="inline-flex items-center gap-1 font-tabular">
                <svg
                  className="w-3 h-3"
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
            {guestCount && (
              <span className="font-tabular font-medium text-foreground">
                {guestCount} guests seated
              </span>
            )}
          </div>

          {(currentBill || orderNumber) && (
            <div className="flex items-baseline justify-between pt-1 border-t border-border-subtle/50">
              <span className="text-muted-foreground truncate">
                {orderNumber ? `Order ${orderNumber}` : 'Current Tab'}
              </span>
              {currentBill && (
                <span className="font-bold font-tabular text-foreground text-sm">
                  {currentBill}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom Action */}
      {onAction && (
        <Button
          type="button"
          variant={state === 'BILL_REQUESTED' ? 'default' : 'outline'}
          size="sm"
          onClick={onAction}
          className="w-full text-xs font-semibold"
        >
          {actionLabel ?? (state === 'BILL_REQUESTED' ? 'Settle Payment' : 'View Table')}
        </Button>
      )}
    </div>
  );
}
