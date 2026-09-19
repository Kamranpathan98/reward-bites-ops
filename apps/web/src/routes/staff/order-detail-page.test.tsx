import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderDetailPage } from './order-detail-page';

vi.mock('@/features/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);
const ORDER_ID = '01a0b0c6-8866-72c2-8fc2-b62bd4d27923';

const baseOrder = {
  id: ORDER_ID,
  tableSessionId: 'session-1',
  orderNumber: '#0001',
  source: 'COUNTER',
  type: 'TAKEAWAY',
  customerName: null,
  status: 'NEW',
  version: 0,
  placedAt: '2026-01-01T00:00:00.000Z',
  acceptedAt: null,
  readyAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  subtotalPaise: 18000,
  lineCount: 1,
  billId: null,
  notes: null,
  lines: [
    {
      id: 'line-1',
      menuItemId: 'item-1',
      menuVariantId: null,
      itemNameSnapshot: 'Noodles',
      variantNameSnapshot: null,
      unitPricePaise: 18000,
      qty: 1,
      lineTotalPaise: 18000,
      notes: null,
      status: 'ACTIVE',
      sortOrder: 0,
      addons: [],
    },
  ],
  history: [
    {
      fromStatus: null,
      toStatus: 'NEW',
      actorKind: 'staff',
      actorId: 'user-1',
      at: '2026-01-01T00:00:00.000Z',
      reason: null,
    },
  ],
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/orders/${ORDER_ID}`]}>
        <Routes>
          <Route path="/app/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows a loading state, then the order detail with lines and history', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/orders/${ORDER_ID}`) return Promise.resolve({ data: baseOrder });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(screen.getByText('Loading order…')).toBeInTheDocument();
    expect(await screen.findByText('1 × Noodles')).toBeInTheDocument();
    // "NEW" appears both in the status badge and the history entry — assert at least one is present.
    expect(screen.getAllByText('NEW').length).toBeGreaterThan(0);
  });

  it('shows an error state with a working retry button', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/orders/${ORDER_ID}`)
        return Promise.reject(
          new ApiError(
            { error: { code: 'NOT_FOUND', message: 'boom', requestId: 'r', retryable: false } },
            404,
          ),
        );
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Could not load this order.')).toBeInTheDocument();

    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/orders/${ORDER_ID}`) return Promise.resolve({ data: baseOrder });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 × Noodles')).toBeInTheDocument();
  });

  it('transitions the order via the "Mark accepted" action', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === `/orders/${ORDER_ID}` && (!options || options.method === undefined))
        return Promise.resolve({ data: baseOrder });
      if (path === `/orders/${ORDER_ID}/transition` && options?.method === 'POST')
        return Promise.resolve({ data: { ...baseOrder, status: 'ACCEPTED', version: 1 } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1 × Noodles');

    await user.click(screen.getByRole('button', { name: 'Mark accepted' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/orders/${ORDER_ID}/transition`,
        expect.objectContaining({ method: 'POST', body: { to: 'ACCEPTED', expectedVersion: 0 } }),
      );
    });
  });

  it('cancels the order with a reason via the cancel form', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === `/orders/${ORDER_ID}` && (!options || options.method === undefined))
        return Promise.resolve({ data: baseOrder });
      if (path === `/orders/${ORDER_ID}/cancel` && options?.method === 'POST')
        return Promise.resolve({ data: { ...baseOrder, status: 'CANCELLED' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1 × Noodles');

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.type(screen.getByLabelText('Cancellation reason'), 'Customer left');
    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/orders/${ORDER_ID}/cancel`,
        expect.objectContaining({
          method: 'POST',
          body: { expectedVersion: 0, reason: 'Customer left' },
        }),
      );
    });
  });

  it('shows a mutation error when a transition fails', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === `/orders/${ORDER_ID}` && (!options || options.method === undefined))
        return Promise.resolve({ data: baseOrder });
      if (path === `/orders/${ORDER_ID}/transition` && options?.method === 'POST')
        return Promise.reject(
          new ApiError(
            {
              error: {
                code: 'VERSION_CONFLICT',
                message: 'Already changed.',
                requestId: 'r',
                retryable: false,
              },
            },
            409,
          ),
        );
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1 × Noodles');

    await user.click(screen.getByRole('button', { name: 'Mark accepted' }));
    expect(await screen.findByText('Already changed.')).toBeInTheDocument();
  });

  it('freezes a billed order: shows a bill link and hides remove/cancel/reopen', async () => {
    const billed = { ...baseOrder, billId: 'bill-9' };
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/orders/${ORDER_ID}`) return Promise.resolve({ data: billed });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    await screen.findByText('1 × Noodles');
    expect(screen.getByText(/This order is on a bill/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View bill' })).toHaveAttribute(
      'href',
      '/app/bills/bill-9',
    );
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });
});
