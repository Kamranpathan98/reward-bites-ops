import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TablesPage } from './tables-page';

// Permission-gating itself is covered by can.test.tsx — here, always show
// gated content so the test can focus on list/create/toggle behaviour.
vi.mock('@/features/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);

const TABLE_ID = '01a0b0c6-8866-72c2-8fc2-b62bd4d27923';

const tables = [
  {
    id: TABLE_ID,
    name: 'Table 1',
    displayOrder: 0,
    capacity: 4,
    isActive: true,
    hasActiveQr: false,
  },
];

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TablesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TablesPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows an empty state when there are no tables', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/tables') return Promise.resolve({ data: [] });
      if (path === '/tables/live') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(await screen.findByText('No tables yet. Add one above.')).toBeInTheDocument();
  });

  it('shows an error state with a working retry button', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/tables')
        return Promise.reject(
          new ApiError(
            { error: { code: 'INTERNAL', message: 'boom', requestId: 'r', retryable: true } },
            500,
          ),
        );
      if (path === '/tables/live') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Could not load tables.')).toBeInTheDocument();

    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/tables') return Promise.resolve({ data: tables });
      if (path === '/tables/live') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Table 1')).toBeInTheDocument();
  });

  it('lists a table with capacity, QR, session, and status badges', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/tables') return Promise.resolve({ data: tables });
      if (path === '/tables/live')
        return Promise.resolve({
          data: [{ ...tables[0], openSession: null }],
        });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();

    const row = (await screen.findByText('Table 1')).closest('tr') as HTMLElement;
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByText('None')).toBeInTheDocument();
    expect(within(row).getByText('Free')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('submits the create-table form with the validated payload', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/tables' && (!options || options.method === undefined))
        return Promise.resolve({ data: tables });
      if (path === '/tables/live') return Promise.resolve({ data: [] });
      if (path === '/tables' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-table-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Table 1');

    await user.type(screen.getByLabelText('Name'), 'Table 2');
    await user.type(screen.getByLabelText('Capacity'), '2');
    await user.click(screen.getByRole('button', { name: 'Add table' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/tables',
        expect.objectContaining({
          method: 'POST',
          body: { name: 'Table 2', capacity: 2 },
        }),
      );
    });
  });

  it('deactivates a table via the row action', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/tables') return Promise.resolve({ data: tables });
      if (path === '/tables/live') return Promise.resolve({ data: [] });
      if (path === `/tables/${TABLE_ID}` && options?.method === 'PATCH')
        return Promise.resolve({ data: true });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Table 1');

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/tables/${TABLE_ID}`,
        expect.objectContaining({ method: 'PATCH', body: { isActive: false } }),
      );
    });
  });
});
