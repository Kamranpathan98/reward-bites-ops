import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

vi.mock('@/features/auth/use-auth', () => ({
  useMe: vi.fn(),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useMe } from '@/features/auth/use-auth';

const meMock = vi.mocked(useMe);

function renderAs(permissions: string[]): void {
  meMock.mockReturnValue({
    data: {
      permissions,
      tenant: { name: 'Test Cafe' },
      membership: { roleName: 'Role' },
    },
    isLoading: false,
    isError: false,
  } as never);
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AppShell />
    </MemoryRouter>,
  );
}

describe('AppShell — Payments navigation', () => {
  beforeEach(() => meMock.mockReset());

  it('links to /app/settings/payments for users with settings.read (Owner and Manager)', () => {
    renderAs(['settings.read']);
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/app/settings/payments',
    );
  });

  it('hides the link from users without settings.read (Cashier, Kitchen Staff)', () => {
    renderAs(['orders.read', 'kitchen.read']);
    expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
  });
});
