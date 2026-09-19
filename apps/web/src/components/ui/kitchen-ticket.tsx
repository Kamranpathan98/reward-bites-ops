import * as React from 'react';
import type { KitchenOrderStatus } from '@rewardbite/contracts';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  variantName?: string | null | undefined;
  status?: ('ACTIVE' | 'REMOVED') | undefined;
  courseCategory?: string | undefined;
  notes?: string | null | undefined;
  completed?: boolean | undefined;
  addons?:
    | Array<{
        addonId?: string | undefined;
        nameSnapshot: string;
        qty: number;
      }>
    | undefined;
}

export interface KitchenTicketProps extends React.HTMLAttributes<HTMLDivElement> {
  ticketNumber?: string | undefined;
  orderNumber?: string | undefined;
  tableNumber?: string | undefined;
  tableName?: string | undefined;
  elapsedTime: string;
  urgency?: ('normal' | 'rush' | 'late') | undefined;
  status?: KitchenOrderStatus | undefined;
  source?: ('COUNTER' | 'QR' | 'QR_DINE_IN') | undefined;
  type?: ('DINE_IN' | 'TAKEAWAY') | undefined;
  customerName?: string | null | undefined;
  notes?: string | null | undefined;
  isEdited?: boolean | undefined;
  editReason?: string | null | undefined;
  guestCount?: number | undefined;
  captain?: string | undefined;
  allergenAlert?: string | undefined;
  items: KitchenItem[];
  onToggleItem?: ((id: string) => void) | undefined;
  onBumpTicket?: (() => void) | undefined;
  bumpLabel?: string | undefined;
  bumpDisabled?: boolean | undefined;
  bumpLoading?: boolean | undefined;
  canAcceptNew?: boolean | undefined;
  /**
   * When `false`, items render as plain read-only rows (no checkbox, no
   * strike-through, no pointer affordance). Defaults to `true` for backward
   * compatibility in design showcase/tests. In production KDS, passes `false`.
   */
  checklist?: boolean | undefined;
}

export function KitchenTicket({
  ticketNumber,
  orderNumber,
  tableNumber,
  tableName,
  elapsedTime,
  urgency = 'normal',
  status,
  source,
  type,
  customerName,
  notes,
  isEdited,
  editReason,
  guestCount,
  captain,
  allergenAlert,
  items,
  onToggleItem,
  onBumpTicket,
  bumpLabel,
  bumpDisabled,
  bumpLoading,
  canAcceptNew = false,
  checklist = true,
  className,
  ...props
}: KitchenTicketProps): JSX.Element {
  const displayTicketNumber = ticketNumber ?? orderNumber ?? '';
  const displayTableNumber = tableNumber ?? tableName ?? '';

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
          <span className="font-bold text-sm tracking-tight font-tabular uppercase truncate">
            {displayTicketNumber}
          </span>
          {source && (
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/20 text-white shrink-0">
              {source === 'QR_DINE_IN' ? 'QR' : source}
            </span>
          )}
          {type && (
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/90 shrink-0">
              {type === 'DINE_IN' ? 'Dine In' : 'Takeaway'}
            </span>
          )}
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
      <div className="bg-surface-muted px-4 py-2 flex items-center justify-between border-b border-border-subtle text-xs gap-2">
        <div className="flex items-center gap-2 truncate">
          <span className="font-bold text-foreground font-tabular text-sm truncate">
            {displayTableNumber}
          </span>
          {customerName && (
            <span className="text-muted-foreground font-medium truncate">• {customerName}</span>
          )}
          {guestCount && (
            <span className="text-muted-foreground font-medium shrink-0">
              • {guestCount} Guests
            </span>
          )}
        </div>
        {captain && (
          <span className="text-muted-foreground truncate max-w-[140px] shrink-0">
            Server: {captain}
          </span>
        )}
      </div>

      {/* Order Notes Banner */}
      {notes && (
        <div className="bg-amber-500/10 text-amber-900 dark:text-amber-200 px-4 py-1.5 text-xs font-medium border-b border-amber-500/20">
          <span className="font-bold">Note: </span>
          {notes}
        </div>
      )}

      {/* Edit Warning Banner */}
      {isEdited && (
        <div className="bg-amber-500 text-amber-950 px-4 py-1.5 flex items-center gap-2 text-xs font-bold border-b border-amber-600">
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="truncate">MODIFIED TICKET{editReason ? ` — ${editReason}` : ''}</span>
        </div>
      )}

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
            const isRemoved = item.status === 'REMOVED';
            const body = (
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={cn(
                      'font-bold text-sm',
                      isRemoved && 'line-through text-muted-foreground',
                    )}
                  >
                    <span className="font-tabular text-primary-strong mr-1">{item.quantity}×</span>
                    {item.name}
                    {item.variantName && (
                      <span className="ml-1 text-xs font-medium text-muted-foreground">
                        ({item.variantName})
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {isRemoved && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20">
                        CANCELLED
                      </span>
                    )}
                    {item.courseCategory && (
                      <span className="text-caption font-semibold bg-surface px-1.5 py-0.2 rounded border border-border-subtle text-muted-foreground">
                        {item.courseCategory}
                      </span>
                    )}
                  </div>
                </div>

                {/* Addons */}
                {item.addons && item.addons.length > 0 && (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {item.addons.map((addon, idx) => (
                      <span
                        key={addon.addonId ?? idx}
                        className={cn(
                          'text-xs text-muted-foreground font-medium',
                          isRemoved && 'line-through',
                        )}
                      >
                        + {addon.nameSnapshot}
                        {addon.qty > 1 ? ` × ${addon.qty}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {item.notes && (
                  <p
                    className={cn(
                      'text-xs font-semibold text-primary-strong mt-0.5 not-italic',
                      isRemoved && 'line-through opacity-70',
                    )}
                  >
                    {item.notes}
                  </p>
                )}
              </div>
            );

            if (!checklist) {
              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-start gap-3 p-2 rounded bg-surface-muted text-foreground',
                    isRemoved && 'opacity-60 bg-surface-muted/40',
                  )}
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
                  item.completed || isRemoved
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

      {/* Bump Button / Action Bar */}
      {status === 'READY' ? (
        <div className="p-3 bg-emerald-500/10 border-t border-emerald-500/20 text-center">
          <span className="font-bold text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1.5">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Ready at Pass
          </span>
        </div>
      ) : status === 'NEW' && !canAcceptNew ? (
        <div className="p-3 bg-surface-muted border-t border-border-subtle">
          <Button
            type="button"
            variant="secondary"
            size="touch"
            disabled
            className="w-full font-bold uppercase tracking-wider opacity-60 cursor-not-allowed"
          >
            Awaiting Counter Acceptance
          </Button>
        </div>
      ) : onBumpTicket ? (
        <div className="p-3 bg-surface-muted border-t border-border-subtle">
          <Button
            type="button"
            variant="default"
            size="touch"
            onClick={onBumpTicket}
            disabled={bumpDisabled || bumpLoading}
            className={cn(
              'w-full font-bold uppercase tracking-wider',
              status === 'NEW' && 'bg-sky-600 hover:bg-sky-700 text-white',
              status === 'ACCEPTED' && 'bg-amber-600 hover:bg-amber-700 text-white',
              status === 'PREPARING' && 'bg-emerald-600 hover:bg-emerald-700 text-white',
            )}
          >
            {bumpLoading
              ? 'Updating…'
              : (bumpLabel ??
                (status === 'NEW'
                  ? 'Accept Order'
                  : status === 'ACCEPTED'
                    ? 'Start Cooking'
                    : status === 'PREPARING'
                      ? 'Mark Ready'
                      : 'Bump Ticket'))}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
