import * as React from 'react';
import { cn } from '@/lib/utils';

// A plain, accessible native <select> styled to match the other shadcn
// primitives here — the Radix Select is deliberately not pulled in for
// Gate 2's one dropdown use case (role assignment); this keeps native
// keyboard/screen-reader behaviour for free.
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
