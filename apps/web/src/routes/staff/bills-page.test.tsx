import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillsPage } from './bills-page';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);

const bill = (over: Record<string, unknown> = {}) => ({
  id: 'bill-1',
  tableSessionId: 'session-1',
  billNumber: 7,
  status: 'FINALIZED',
  subtotalPaise: 18000,
  discountPaise: 0,
  roundingPaise: 0,
  grandTotalPaise: 18000,
  paidPaise: 0,
  outstandingPaise: 18000,
  version: 2,
  customerName: null,
  notes: null,
  finalizedAt: '2026-01-01T00:00:00.000Z',
  finalizedBy: null,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillsPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows loading, then the empty state', async () => {
    apiFetchMock.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderPage();
    expect(screen.getByText('Loading bills…')).toBeInTheDocument();
    expect(await screen.findByText('No bills yet.')).toBeInTheDocument();
  });

  it('lists bills with number and status, linking to the detail page', async () => {
    apiFetchMock.mockResolvedValue({
      data: [
        bill(),
        bill({ id: 'bill-2', billNumber: null, status: 'DRAFT', outstandingPaise: 0 }),
      ],
      meta: { nextCursor: null },
    });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Bill 0007' });
    expect(link).toHaveAttribute('href', '/app/bills/bill-1');
    expect(screen.getByText('Awaiting payment', { selector: 'span,div' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft bill' })).toBeInTheDocument();
  });

  it('filters by status via the query string', async () => {
    apiFetchMock.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No bills yet.');
    await user.click(screen.getByRole('button', { name: 'Paid' }));
    await screen.findByText('No bills yet.');
    expect(apiFetchMock).toHaveBeenCalledWith('/bills?status=PAID');
  });

  it('shows an error with a working retry', async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(
        { error: { code: 'INTERNAL', message: 'boom', requestId: 'r', retryable: true } },
        500,
      ),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Could not load bills.')).toBeInTheDocument();
    apiFetchMock.mockResolvedValue({ data: [bill()], meta: { nextCursor: null } });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Bill 0007' })).toBeInTheDocument();
  });
});
