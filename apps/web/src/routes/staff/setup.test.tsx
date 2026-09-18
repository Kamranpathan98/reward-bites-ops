import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from './setup';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SetupPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows a first-table form when the tenant has no tables yet', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/tables') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();

    expect(await screen.findByLabelText('Table name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add table' })).toBeInTheDocument();
  });

  it('creates the first table via the existing Gate 4 endpoint, reusing its own hook', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/tables' && (!options || options.method === undefined))
        return Promise.resolve({ data: [] });
      if (path === '/tables' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'table-1' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Table name'), 'Table 1');
    await user.click(screen.getByRole('button', { name: 'Add table' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/tables',
        expect.objectContaining({ method: 'POST', body: { name: 'Table 1' } }),
      );
    });
  });

  it('shows a ready state with dashboard/tables links once at least one table exists', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/tables') return Promise.resolve({ data: [{ id: 't1', name: 'Table 1' }] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();

    expect(await screen.findByText(/you have 1 table/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: 'Add more tables' })).toHaveAttribute(
      'href',
      '/app/tables',
    );
  });
});
