import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The single availability treatment used on the landing page. Sections whose
 * product surface is not shipped yet carry exactly one of these next to their
 * heading — it is not repeated inside the section copy.
 */
export function ComingSoon({ className }: { className?: string }): JSX.Element {
  return (
    <Badge variant="muted" className={cn('font-semibold', className)}>
      Coming soon
    </Badge>
  );
}

export interface SectionHeaderProps {
  id?: string;
  title: string;
  children?: React.ReactNode;
  comingSoon?: boolean;
  className?: string;
}

/** Section heading (h2) with an optional lead paragraph. */
export function SectionHeader({
  id,
  title,
  children,
  comingSoon = false,
  className,
}: SectionHeaderProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={id} className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {comingSoon && <ComingSoon />}
      </div>
      {children && (
        <p className="text-base text-muted-foreground leading-relaxed max-w-prose">{children}</p>
      )}
    </div>
  );
}
