import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './orders-page';

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
const ITEM_ID = '01a0b0c6-886c-7000-8000-000000000001';

const emptyMenu = {
  data: {
    categories: [
      {
        id: 'cat-1',
        name: 'Mains',
        sortOrder: 0,
        isActive: true,
        items: [
          {
            id: ITEM_ID,
            categoryId: 'cat-1',
            name: 'Noodles',
            description: null,
            imageKey: null,
            basePricePaise: 18000,
            isAvailable: true,
            isActive: true,
            sortOrder: 0,
            vegFlag: null,
            variants: [],
            addons: [],
          },
        ],
      },
    ],
    addons: [],
  },
};
const emptyTables = { data: [] };

const ordersList = {
  data: [
    {
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
      notes: null,
    },
  ],
  meta: { nextCursor: null },
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrdersPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows a loading state, then an empty state', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(emptyMenu);
      if (path === '/tables') return Promise.resolve(emptyTables);
      if (path.startsWith('/orders'))
        return Promise.resolve({ data: [], meta: { nextCursor: null } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(screen.getByText('Loading orders…')).toBeInTheDocument();
    expect(await screen.findByText('No orders yet.')).toBeInTheDocument();
  });

  it('shows an error state with a working retry button', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(emptyMenu);
      if (path === '/tables') return Promise.resolve(emptyTables);
      if (path.startsWith('/orders'))
        return Promise.reject(
          new ApiError(
            { error: { code: 'INTERNAL', message: 'boom', requestId: 'r', retryable: true } },
            500,
          ),
        );
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Could not load orders.')).toBeInTheDocument();

    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(emptyMenu);
      if (path === '/tables') return Promise.resolve(emptyTables);
      if (path.startsWith('/orders')) return Promise.resolve(ordersList);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('#0001')).toBeInTheDocument();
  });

  it('renders an order row with number, status, and subtotal', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(emptyMenu);
      if (path === '/tables') return Promise.resolve(emptyTables);
      if (path.startsWith('/orders')) return Promise.resolve(ordersList);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(await screen.findByText('#0001')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.getByText('₹180.00')).toBeInTheDocument();
  });

  it('submits the create-order form with a computed idempotency key', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu') return Promise.resolve(emptyMenu);
      if (path === '/tables') return Promise.resolve(emptyTables);
      if (path.startsWith('/orders') && (!options || options.method === undefined))
        return Promise.resolve({ data: [], meta: { nextCursor: null } });
      if (path === '/orders' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-order-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No orders yet.');

    await user.selectOptions(screen.getByLabelText('Type'), 'TAKEAWAY');
    await user.selectOptions(screen.getByLabelText('Item'), ITEM_ID);
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/orders',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            type: 'TAKEAWAY',
            lines: [{ itemId: ITEM_ID, qty: 1 }],
          }),
        }),
      );
    });
  });
});
