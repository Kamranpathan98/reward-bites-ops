import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  courseCategory?: string;
  notes?: string;
  completed?: boolean;
}

export interface KitchenTicketProps extends React.HTMLAttributes<HTMLDivElement> {
  ticketNumber: string;
  tableNumber: string;
  elapsedTime: string;
  urgency?: 'normal' | 'rush' | 'late';
  guestCount?: number;
  captain?: string;
  allergenAlert?: string;
  items: KitchenItem[];
  onToggleItem?: (id: string) => void;
  onBumpTicket?: () => void;
  bumpLabel?: string;
  /**
   * When `false`, items render as plain read-only rows (no checkbox, no
   * strike-through, no pointer affordance). Defaults to `true`, the original
   * interactive checklist. Illustrations that must not imply per-item
   * completion pass `false`.
   */
  checklist?: boolean;
}

export function KitchenTicket({
  ticketNumber,
  tableNumber,
  elapsedTime,
  urgency = 'normal',
  guestCount,
  captain,
  allergenAlert,
  items,
  onToggleItem,
  onBumpTicket,
  bumpLabel = 'Bump Ticket',
  checklist = true,
  className,
  ...props
}: KitchenTicketProps): JSX.Element {
  const urgencyStyles = {
    normal: {
      header: 'bg-secondary text-secondary-foreground',
      badge: 'bg-surface-muted text-foreground',
      border: 'border-border',
    },
    rush: {
      header: 'bg-amber-600 text-white',
      badge: 'bg-amber-700 text-white',
      border: 'border-amber-400',
    },
    late: {
      header: 'bg-rose-600 text-white',
      badge: 'bg-rose-800 text-white',
      border: 'border-rose-500 ring-2 ring-rose-500/30',
    },
  }[urgency];

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl overflow-hidden border bg-surface shadow-sm transition-all duration-200',
        urgencyStyles.border,
        className,
      )}
      {...props}
    >
      {/* Docket Header */}
      <div
        className={cn('px-4 py-3 flex items-center justify-between gap-2', urgencyStyles.header)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-sm tracking-tight font-tabular uppercase">
            {ticketNumber}
          </span>
        </div>
        <div
          className={cn(
            'px-2 py-0.5 rounded text-xs font-black font-tabular flex items-center gap-1 shadow-sm shrink-0',
            urgencyStyles.badge,
          )}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{elapsedTime}</span>
        </div>
      </div>

      {/* Meta Bar */}
      <div className="bg-surface-muted px-4 py-2 flex items-center justify-between border-b border-border-subtle text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground font-tabular text-sm">{tableNumber}</span>
          {guestCount && (
            <span className="text-muted-foreground font-medium">• {guestCount} Guests</span>
          )}
        </div>
        {captain && (
          <span className="text-muted-foreground truncate max-w-[140px]">Server: {captain}</span>
        )}
      </div>

      {/* Allergy Alert Banner */}
      {allergenAlert && (
        <div className="bg-rose-100 text-rose-900 px-4 py-2 flex items-center gap-2 text-xs font-bold border-b border-rose-200">
          <svg
            className="w-4 h-4 text-rose-600 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polygon points="12 2 2 22 22 22" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <circle cx="12" cy="17" r="1" />
          </svg>
          <span className="truncate">{allergenAlert}</span>
        </div>
      )}

      {/* Item Checklist */}
      <div className="p-4 flex-1 flex flex-col gap-2 bg-surface">
        <span className="text-caption uppercase font-bold tracking-wider text-muted-foreground">
          Items to Cook
        </span>
        <div className="flex flex-col gap-1.5">
          {items.map((item) => {
            const body = (
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-bold text-sm">
                    <span className="font-tabular text-primary-strong mr-1">{item.quantity}×</span>
                    {item.name}
                  </span>
                  {item.courseCategory && (
                    <span className="text-caption font-semibold bg-surface px-1.5 py-0.2 rounded border border-border-subtle text-muted-foreground shrink-0">
                      {item.courseCategory}
                    </span>
                  )}
                </div>
                {item.notes && (
                  <p className="text-xs font-semibold text-primary-strong mt-0.5 not-italic">
                    {item.notes}
                  </p>
                )}
              </div>
            );

            if (!checklist) {
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-2 rounded bg-surface-muted text-foreground"
                >
                  {body}
                </div>
              );
            }

            return (
              <label
                key={item.id}
                onClick={() => onToggleItem?.(item.id)}
                className={cn(
                  'flex items-start gap-3 p-2 rounded transition-colors cursor-pointer select-none border border-transparent',
                  item.completed
                    ? 'bg-surface-muted/50 text-muted-foreground line-through opacity-60'
                    : 'bg-surface-muted hover:bg-surface-muted/80 text-foreground hover:border-border-subtle',
                )}
              >
                <input
                  type="checkbox"
                  checked={!!item.completed}
                  onChange={() => {}} // Handled by label click
                  className="w-4 h-4 mt-0.5 rounded accent-primary cursor-pointer shrink-0"
                />
                {body}
              </label>
            );
          })}
        </div>
      </div>

      {/* Bump Button */}
      {onBumpTicket && (
        <div className="p-3 bg-surface-muted border-t border-border-subtle">
          <Button
            type="button"
            variant="default"
            size="touch"
            onClick={onBumpTicket}
            className="w-full font-bold uppercase tracking-wider"
          >
            {bumpLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
