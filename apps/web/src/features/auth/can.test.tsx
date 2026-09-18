import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { Can } from './can';
import * as useAuthModule from './use-auth';

function renderWithClient(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('<Can>', () => {
  it('renders children when the current membership has the permission', () => {
    vi.spyOn(useAuthModule, 'useMe').mockReturnValue({
      data: { permissions: ['users.manage'] },
    } as unknown as ReturnType<typeof useAuthModule.useMe>);

    renderWithClient(
      <Can permission="users.manage">
        <button>Invite</button>
      </Can>,
    );

    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('renders the fallback (default: nothing) when the permission is missing', () => {
    vi.spyOn(useAuthModule, 'useMe').mockReturnValue({
      data: { permissions: ['users.read'] },
    } as unknown as ReturnType<typeof useAuthModule.useMe>);

    renderWithClient(
      <Can permission="users.manage">
        <button>Invite</button>
      </Can>,
    );

    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
  });

  it('renders an explicit fallback when provided', () => {
    vi.spyOn(useAuthModule, 'useMe').mockReturnValue({
      data: { permissions: [] },
    } as unknown as ReturnType<typeof useAuthModule.useMe>);

    renderWithClient(
      <Can permission="users.manage" fallback={<span>Read-only</span>}>
        <button>Invite</button>
      </Can>,
    );

    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('treats a still-loading useMe (no data yet) as not permitted', () => {
    vi.spyOn(useAuthModule, 'useMe').mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useAuthModule.useMe>);

    renderWithClient(
      <Can permission="users.manage">
        <button>Invite</button>
      </Can>,
    );

    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
  });
});
