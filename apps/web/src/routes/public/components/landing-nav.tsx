import * as React from 'react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LandingNavProps {
  className?: string;
}

const NAV_LINKS = [
  { href: '#workflow', label: 'How it works' },
  { href: '#qr-ordering', label: 'QR ordering' },
  { href: '#kitchen', label: 'Kitchen' },
  { href: '#billing', label: 'Billing' },
  { href: '#faq', label: 'FAQ' },
];

const linkClass =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function MenuIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      ) : (
        <>
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </>
      )}
    </svg>
  );
}

/**
 * Site header. The full inline nav only appears from `lg` up; below that the
 * links live behind a menu button so the header row is always just
 * brand + one CTA + menu, which fits every width down to 320px.
 */
export function LandingNav({ className }: LandingNavProps): JSX.Element {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const closeMenu = (): void => setMenuOpen(false);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80',
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-strong text-primary-foreground"
            aria-hidden="true"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground">RewardBite</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2">
          <Link
            to="/app/login"
            className={cn(buttonVariants({ variant: 'ghost', size: 'touch' }), 'px-4')}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className={cn(buttonVariants({ variant: 'default', size: 'touch' }), 'px-5')}
          >
            Get started
          </Link>
        </div>

        <div className="flex lg:hidden items-center gap-2">
          <Link
            to="/signup"
            className={cn(buttonVariants({ variant: 'default', size: 'touch' }), 'px-4')}
          >
            Get started
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MenuIcon open={menuOpen} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          id="mobile-nav-panel"
          className="lg:hidden border-t border-border bg-surface px-4 py-3 shadow-popover"
        >
          <nav className="flex flex-col" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className={cn(linkClass, 'text-foreground')}
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/app/login"
              onClick={closeMenu}
              className={cn(buttonVariants({ variant: 'outline', size: 'touch' }), 'mt-2 w-full')}
            >
              Sign in
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
