import * as React from 'react';
import { cn } from '@/lib/utils';

export type TabsListProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Tablist with the WAI-ARIA keyboard model: roving tabindex (only the active
 * tab is in the Tab order) and ArrowLeft / ArrowRight / Home / End to move
 * between tabs. Arrow keys activate the focused tab (automatic activation),
 * which is what the simple filter/segment usages in this app want.
 */
export function TabsList({ className, onKeyDown, ...props }: TabsListProps): JSX.Element {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (tabs.length === 0) return;

    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;

    let next = -1;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const target = tabs[next];
    target?.focus();
    target?.click();
  };

  return (
    <div
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex items-center gap-1 p-1 bg-surface-muted rounded-lg overflow-x-auto max-w-full',
        className,
      )}
      {...props}
    />
  );
}

export interface TabTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number | string;
}

export function TabTrigger({
  active = false,
  count,
  className,
  children,
  ...props
}: TabTriggerProps): JSX.Element {
  return (
    <button
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      type="button"
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-all select-none whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-surface text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface/50',
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={cn(
            'px-1.5 py-0.2 rounded-full font-tabular text-caption font-bold',
            active ? 'bg-surface-muted text-foreground' : 'bg-surface/80 text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
