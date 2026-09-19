import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Can } from '@/features/auth/can';
import { useLogout, useMe } from '@/features/auth/use-auth';

const navItems = [
  { to: '/app', label: 'Dashboard', disabled: true },
  { to: '/app', label: 'Dashboard', permission: 'dashboard.read' as const },
  { to: '/app/orders', label: 'Orders', permission: 'orders.read' as const },
  { to: '/app/kitchen', label: 'Kitchen', permission: 'kitchen.read' as const },
  { to: '/app/bills', label: 'Bills', permission: 'bills.read' as const },
  { to: '/app/expenses', label: 'Expenses', permission: 'expenses.read' as const },
  { to: '/app/tables', label: 'Tables', permission: 'tables.read' as const },
  { to: '/app/menu', label: 'Menu', permission: 'menu.read' as const },
  { to: '/app/settings/users', label: 'Users', permission: 'users.read' as const },
];

export function AppShell(): JSX.Element {
  const { data: me, isLoading, isError } = useMe();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-y-2 border-b border-border px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="font-semibold">RewardBite</span>
          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map((item) =>
              item.disabled ? (
                <span
                  key={item.to}
                  title="Coming in a later gate"
                  className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-muted-foreground opacity-50"
                >
                  {item.label}
                </span>
              ) : item.permission ? (
                <Can key={item.to} permission={item.permission}>
                  <NavItem to={item.to} label={item.label} />
                </Can>
              ) : (
                <NavItem key={item.to} to={item.to} label={item.label} />
              ),
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {isLoading && <span className="text-muted-foreground">Loading…</span>}
          {isError && <span className="text-red-600">Could not load account</span>}
          {me && (
            <span className="text-muted-foreground">
              {me.tenant.name} · {me.membership.roleName}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? 'Signing out…' : 'Log out'}
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, label }: { to: string; label: string }): JSX.Element {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted',
          isActive && 'bg-surface-muted font-medium',
        )
      }
    >
      {label}
    </NavLink>
  );
}
