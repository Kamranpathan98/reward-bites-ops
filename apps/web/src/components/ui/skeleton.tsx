import * as React from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-slate-200/80', className)}
      {...props}
    />
  );
}
