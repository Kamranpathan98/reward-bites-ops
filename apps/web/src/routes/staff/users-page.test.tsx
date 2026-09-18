import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersPage } from './users-page';

// Permission-gating itself is covered by can.test.tsx — here, always show
// gated content so the test can focus on list/invite/role-change behaviour.
vi.mock('@/features/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);

const OWNER_ROLE_ID = '01a0b0c6-8866-72c2-8fc2-b62bd4d27923';
const CASHIER_ROLE_ID = '01a0b0c6-8869-7f64-a105-d9d8be62d93f';
const MEMBERSHIP_ID = '01a0b0c6-886b-7a11-9c22-1234567890ab';

const roles = [
  { id: OWNER_ROLE_ID, name: 'Owner', isSystem: true },
  { id: CASHIER_ROLE_ID, name: 'Cashier', isSystem: true },
];

const users = [
  {
    membershipId: MEMBERSHIP_ID,
    userId: '01a0b0c6-886c-7000-8000-000000000001',
    email: 'owner@example.com',
    fullName: 'Owner Person',
    status: 'ACTIVE',
    roleId: OWNER_ROLE_ID,
    roleName: 'Owner',
    joinedAt: '2026-01-01T00:00:00.000Z',
  },
];

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows a loading state, then the user list', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return new Promise(() => undefined); // never resolves during this assertion
      if (path === '/roles') return Promise.resolve({ data: roles });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(screen.getByText('Loading users…')).toBeInTheDocument();
  });

  it('renders users once loaded, and an empty state when there are none', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ data: [] });
      if (path === '/roles') return Promise.resolve({ data: roles });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(await screen.findByText('No users yet.')).toBeInTheDocument();
  });

  it('shows an error state with a working retry button', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users')
        return Promise.reject(
          new ApiError(
            { error: { code: 'INTERNAL', message: 'boom', requestId: 'r', retryable: true } },
            500,
          ),
        );
      if (path === '/roles') return Promise.resolve({ data: roles });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Could not load users.')).toBeInTheDocument();

    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ data: users });
      if (path === '/roles') return Promise.resolve({ data: roles });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
  });

  it('lists a real user row with name, email, role, and status', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ data: users });
      if (path === '/roles') return Promise.resolve({ data: roles });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();

    const row = (await screen.findByText('owner@example.com')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Owner Person')).toBeInTheDocument();
    expect(within(row).getByText('ACTIVE')).toBeInTheDocument();
  });

  it('submits the invite form with the validated payload', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/users' && (!options || options.method === undefined))
        return Promise.resolve({ data: users });
      if (path === '/roles') return Promise.resolve({ data: roles });
      if (path === '/users/invite') return Promise.resolve({ data: { membershipId: 'mem-2' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('owner@example.com');

    await user.type(screen.getByLabelText('Email'), 'cashier@example.com');
    await user.type(screen.getByLabelText('Full name'), 'New Cashier');
    await user.selectOptions(screen.getByLabelText('Role'), CASHIER_ROLE_ID);
    await user.type(screen.getByLabelText('Temporary password'), 'a-real-password-123');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/users/invite',
        expect.objectContaining({
          method: 'POST',
          body: {
            email: 'cashier@example.com',
            fullName: 'New Cashier',
            roleId: CASHIER_ROLE_ID,
            tempPassword: 'a-real-password-123',
          },
        }),
      );
    });
  });

  it("changes a user's role via the role select", async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/users') return Promise.resolve({ data: users });
      if (path === '/roles') return Promise.resolve({ data: roles });
      if (path === `/users/${MEMBERSHIP_ID}` && options?.method === 'PATCH')
        return Promise.resolve({ data: true });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('owner@example.com');

    const roleSelect = screen.getByLabelText('Role for Owner Person');
    await user.selectOptions(roleSelect, CASHIER_ROLE_ID);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/users/${MEMBERSHIP_ID}`,
        expect.objectContaining({ method: 'PATCH', body: { roleId: CASHIER_ROLE_ID } }),
      );
    });
  });
});
