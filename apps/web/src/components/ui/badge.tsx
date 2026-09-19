import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors font-tabular',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary-strong text-primary-foreground',
        secondary: 'border-transparent bg-surface-muted text-foreground',
        outline: 'border-border text-foreground bg-surface',
        muted: 'border-border-subtle bg-surface-muted text-muted-foreground',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        warning: 'border-amber-200 bg-amber-50 text-amber-800',
        info: 'border-sky-200 bg-sky-50 text-sky-700',
        destructive: 'border-rose-200 bg-rose-50 text-rose-700',
      },
      size: {
        default: 'px-2.5 py-0.5 text-xs',
        sm: 'px-1.5 py-0.2 text-caption',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export { badgeVariants };

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
