import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  sizeVariant?: 'default' | 'touch';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, sizeVariant = 'default', children, ...props }, ref) => (
    <select
      className={cn(
        'flex w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-muted cursor-pointer',
        sizeVariant === 'touch' ? 'h-11 text-base' : 'h-9 text-sm',
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
