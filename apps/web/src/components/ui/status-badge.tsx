import * as React from 'react';
import { cn } from '@/lib/utils';

export type OperationalStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'PAID'
  | 'PENDING'
  | 'CANCELLED'
  | 'VOID';

interface StatusConfig {
  label: string;
  className: string;
  icon: (className?: string) => JSX.Element;
  dotColor: string;
  description: string;
}

export const STATUS_CONFIG: Record<OperationalStatus, StatusConfig> = {
  NEW: {
    label: 'New',
    className: 'bg-status-new-surface text-status-new-text border-status-new-border',
    dotColor: 'bg-status-new',
    description: 'Incoming order or fresh QR session awaiting staff acceptance',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.912 5.885h6.188l-5.007 3.638 1.912 5.885-5.005-3.638-5.005 3.638 1.912-5.885-5.007-3.638h6.188z" />
      </svg>
    ),
  },
  ACCEPTED: {
    label: 'Accepted',
    className: 'bg-status-accepted-surface text-status-accepted-text border-status-accepted-border',
    dotColor: 'bg-status-accepted',
    description: 'Acknowledged by staff, queued for kitchen preparation',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  PREPARING: {
    label: 'Preparing',
    className:
      'bg-status-preparing-surface text-status-preparing-text border-status-preparing-border',
    dotColor: 'bg-status-preparing',
    description: 'Kitchen is actively preparing items',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
  READY: {
    label: 'Ready',
    className: 'bg-status-ready-surface text-status-ready-text border-status-ready-border',
    dotColor: 'bg-status-ready',
    description: 'Plated, verified, and ready for runner pickup',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  COMPLETED: {
    label: 'Completed',
    className:
      'bg-status-completed-surface text-status-completed-text border-status-completed-border',
    dotColor: 'bg-status-completed',
    description: 'Delivered to customer and dining session fulfilled',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  PAID: {
    label: 'Paid',
    className: 'bg-status-paid-surface text-status-paid-text border-status-paid-border',
    dotColor: 'bg-status-paid',
    description: 'Settlement confirmed via Cash, UPI, or Card',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  PENDING: {
    label: 'Pending',
    className: 'bg-status-pending-surface text-status-pending-text border-status-pending-border',
    dotColor: 'bg-status-pending',
    description: 'Awaiting customer payment, bill call, or table seating',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  CANCELLED: {
    label: 'Cancelled',
    className:
      'bg-status-cancelled-surface text-status-cancelled-text border-status-cancelled-border',
    dotColor: 'bg-status-cancelled',
    description: 'Cancelled by customer or staff before preparation',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  VOID: {
    label: 'Void',
    className: 'bg-status-void-surface text-status-void-text border-status-void-border',
    dotColor: 'bg-status-void',
    description: 'Invalidated transaction, voided ticket, or inventory write-off',
    icon: (cls = 'w-3 h-3') => (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    ),
  },
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: OperationalStatus | string;
  showIcon?: boolean;
  showDot?: boolean;
  size?: 'sm' | 'default' | 'lg';
}

export function StatusBadge({
  status,
  showIcon = true,
  showDot = false,
  size = 'default',
  className,
  children,
  ...props
}: StatusBadgeProps): JSX.Element {
  const normalizedKey = (status?.toUpperCase() || 'PENDING') as OperationalStatus;
  const config = STATUS_CONFIG[normalizedKey] || STATUS_CONFIG.PENDING;

  const sizeStyles = {
    sm: 'px-1.5 py-0.5 text-caption gap-1',
    default: 'px-2 py-0.5 text-xs gap-1.5',
    lg: 'px-2.5 py-1 text-sm gap-2',
  }[size];

  return (
    <span
      role="status"
      aria-label={`Status: ${config.label}`}
      className={cn(
        'inline-flex items-center font-medium border rounded font-tabular select-none tracking-normal',
        sizeStyles,
        config.className,
        className,
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dotColor)}
          aria-hidden="true"
        />
      )}
      {showIcon && config.icon(size === 'sm' ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0')}
      <span>{children ?? config.label}</span>
    </span>
  );
}
