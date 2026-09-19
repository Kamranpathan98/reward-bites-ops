import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillDetailPage } from './bill-detail-page';

vi.mock('@/features/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);
const BILL_ID = 'bill-1';

const baseBill = {
  id: BILL_ID,
  tableSessionId: 'session-1',
  billNumber: null,
  status: 'DRAFT',
  subtotalPaise: 18050,
  discountPaise: 0,
  roundingPaise: -50,
  grandTotalPaise: 18000,
  paidPaise: 0,
  outstandingPaise: 18000,
  version: 3,
  customerName: null,
  notes: null,
  finalizedAt: null,
  finalizedBy: null,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderIds: ['order-1'],
  lines: [
    {
      id: 'l1',
      orderId: 'order-1',
      lineKind: 'ITEM',
      description: 'Noodles',
      qty: 1,
      unitPricePaise: 18050,
      lineTotalPaise: 18050,
    },
  ],
  adjustments: [],
};

const finalized = { ...baseBill, status: 'FINALIZED', billNumber: 9 };

type PostHandler = (path: string, body: unknown) => unknown;

/** Serves GET bill / payments and routes every mutation through `onPost`. */
function serve(bill: Record<string, unknown>, onPost?: PostHandler): void {
  apiFetchMock.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    if (options?.method && options.method !== 'GET' && onPost) {
      try {
        return Promise.resolve(onPost(path, options.body));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    if (path === `/bills/${BILL_ID}`) return Promise.resolve({ data: bill });
    if (path === `/bills/${BILL_ID}/payments`) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected ${options?.method ?? 'GET'} ${path}`));
  });
}

function postCalls(): unknown[][] {
  return apiFetchMock.mock.calls.filter(([, options]) => {
    const method = (options as { method?: string } | undefined)?.method;
    return method !== undefined && method !== 'GET';
  });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/bills/${BILL_ID}`]}>
        <Routes>
          <Route path="/app/bills/:id" element={<BillDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillDetailPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows lines, signed rounding and the grand total for a draft', async () => {
    serve(baseBill);
    renderPage();
    expect(await screen.findByText('Noodles')).toBeInTheDocument();
    expect(screen.getByText('Rounding')).toBeInTheDocument();
    expect(screen.getByText('-₹0.50')).toBeInTheDocument();
    expect(screen.getByText('Grand total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize bill' })).toBeInTheDocument();
    expect(screen.queryByText('Record payment')).not.toBeInTheDocument();
  });

  it('finalizes with the version and the grand total the user saw', async () => {
    const user = userEvent.setup();
    serve(baseBill, () => ({ data: finalized }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Finalize bill' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/bills/${BILL_ID}/finalize`,
        expect.objectContaining({
          method: 'POST',
          body: { expectedVersion: 3, expectedGrandTotalPaise: 18000 },
        }),
      ),
    );
  });

  it('rejects an invalid discount client-side without calling the API', async () => {
    const user = userEvent.setup();
    serve(baseBill);
    renderPage();
    await screen.findByText('Noodles');
    await user.type(screen.getByLabelText('Percent'), '1.234');
    await user.click(screen.getByRole('button', { name: 'Apply discount' }));
    expect(await screen.findByText(/Enter a percentage/)).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
  });

  it('sends a percent discount as basis points', async () => {
    const user = userEvent.setup();
    serve(baseBill, () => ({ data: baseBill }));
    renderPage();
    await screen.findByText('Noodles');
    await user.type(screen.getByLabelText('Percent'), '10.5');
    await user.click(screen.getByRole('button', { name: 'Apply discount' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/bills/${BILL_ID}/adjustments`,
        expect.objectContaining({
          method: 'PATCH',
          body: { expectedVersion: 3, discount: { kind: 'PERCENT', value: 1050 } },
        }),
      ),
    );
  });

  it('shows the server message when finalize fails', async () => {
    const user = userEvent.setup();
    serve(baseBill, () => {
      throw new ApiError(
        {
          error: {
            code: 'BILL_TOTALS_CHANGED',
            message: 'Totals changed.',
            requestId: 'r',
            retryable: false,
          },
        },
        409,
      );
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Finalize bill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Totals changed.');
  });

  it('for a FINALIZED bill offers payment and void, and no draft actions', async () => {
    serve(finalized);
    renderPage();
    expect(await screen.findByText('Record payment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void bill' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize bill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
  });

  it('records the full outstanding amount as cash with an idempotency key', async () => {
    const user = userEvent.setup();
    serve(finalized, () => ({ data: {} }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Record ₹180.00' }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [path, options] = postCalls()[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/payments');
    expect(options.body).toMatchObject({
      billId: BILL_ID,
      method: 'CASH',
      amountPaise: 18000,
      expectedBillVersion: 3,
    });
    expect(options.body['idempotencyKey']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends the UTR as the provider reference for UPI', async () => {
    const user = userEvent.setup();
    serve(finalized, () => ({ data: {} }));
    renderPage();
    await screen.findByText('Record payment');
    await user.selectOptions(screen.getByLabelText('Method'), 'UPI_STATIC');
    await user.type(screen.getByLabelText(/UPI reference/), '123456789012');
    await user.click(screen.getByRole('button', { name: 'Record ₹180.00' }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, options] = postCalls()[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toMatchObject({
      method: 'UPI_STATIC',
      providerReference: '123456789012',
    });
  });

  it('requires a reason to void', async () => {
    const user = userEvent.setup();
    serve(finalized);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Void bill' }));
    expect(screen.getByRole('button', { name: 'Confirm void' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reason for voiding'), 'wrong table');
    expect(screen.getByRole('button', { name: 'Confirm void' })).toBeEnabled();
  });

  it('shows a terminal PAID bill read-only', async () => {
    serve({ ...finalized, status: 'PAID', paidPaise: 18000, outstandingPaise: 0 });
    renderPage();
    await screen.findByText('Noodles');
    expect(screen.queryByRole('button', { name: /Record/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void bill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize bill' })).not.toBeInTheDocument();
  });
});
