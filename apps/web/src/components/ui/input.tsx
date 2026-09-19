import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  sizeVariant?: 'default' | 'touch';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, sizeVariant = 'default', type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-muted aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/30',
        sizeVariant === 'touch' ? 'h-11 text-base' : 'h-9 text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
