import * as React from 'react';
import { cn } from '@/lib/utils';

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
  icon?: React.ReactNode;
  progressPercent?: number;
  progressColor?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  progressPercent,
  progressColor = 'bg-primary',
  className,
  ...props
}: MetricCardProps): JSX.Element {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg bg-surface border border-border p-5 shadow-sm transition-shadow hover:shadow-card flex flex-col justify-between gap-4',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl lg:text-3xl font-bold font-tabular text-foreground tracking-tight">
              {value}
            </span>
          </div>
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-surface-muted border border-border-subtle flex items-center justify-center text-primary-strong shrink-0">
            {icon}
          </div>
        )}
      </div>

      {(trend || subtitle) && (
        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          {trend && (
            <div
              className={cn(
                'inline-flex items-center gap-1 font-semibold font-tabular',
                trend.isPositive ? 'text-emerald-700' : 'text-rose-600',
              )}
            >
              <span>{trend.isPositive ? '↑' : '↓'}</span>
              <span>{trend.value}</span>
              {trend.label && (
                <span className="font-normal text-muted-foreground ml-0.5">{trend.label}</span>
              )}
            </div>
          )}
          {subtitle && (
            <span className="font-tabular text-muted-foreground bg-surface-subtle px-2 py-0.5 rounded ml-auto text-caption">
              {subtitle}
            </span>
          )}
        </div>
      )}

      {typeof progressPercent === 'number' && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-surface-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-300', progressColor)}
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  );
}
