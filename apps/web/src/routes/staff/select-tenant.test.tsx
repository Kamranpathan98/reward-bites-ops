import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-context';
import { SelectTenantPage } from './select-tenant';

const memberships = [
  {
    membershipId: 'mem-a',
    tenantId: 'tenant-a',
    tenantName: 'Tenant A',
    tenantSlug: 'tenant-a',
    roleName: 'Owner',
  },
  {
    membershipId: 'mem-b',
    tenantId: 'tenant-b',
    tenantName: 'Tenant B',
    tenantSlug: 'tenant-b',
    roleName: 'Manager',
  },
];

function renderPage(initialState: unknown): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[{ pathname: '/app/select-tenant', state: initialState }]}>
          <Routes>
            <Route path="/app/select-tenant" element={<SelectTenantPage />} />
            <Route path="/app" element={<div>Authenticated app home</div>} />
            <Route path="/app/login" element={<div>Login screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('SelectTenantPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
  });

  it('shows a "no tenant access" state when there are no memberships', async () => {
    renderPage({ memberships: [] });
    expect(await screen.findByText('No tenant access')).toBeInTheDocument();
  });

  it('lists every membership by tenant name and role', async () => {
    renderPage({ memberships });
    expect(await screen.findByText('Tenant A')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Tenant B')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
  });

  it('selecting a tenant calls select-tenant and navigates to the app on success', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/select-tenant')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ accessToken: 'new-token' }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    renderPage({ memberships });
    await user.click(await screen.findByRole('button', { name: /Tenant A.*Owner/s }));

    await waitFor(() => {
      expect(screen.getByText('Authenticated app home')).toBeInTheDocument();
    });
  });

  it('shows an error message when select-tenant fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/select-tenant')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 'NOT_FOUND',
              message: 'Membership not found.',
              requestId: 'r',
              retryable: false,
            },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    renderPage({ memberships });
    await user.click(await screen.findByRole('button', { name: /Tenant A.*Owner/s }));

    expect(await screen.findByText('Membership not found.')).toBeInTheDocument();
  });
});
