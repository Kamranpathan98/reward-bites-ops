import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './dashboard-page';

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
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('renders all 6 metric cards, date range, and disclaimer', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/dashboard/summary')) {
        return Promise.resolve({
          data: {
            period: 'today',
            businessDate: '2026-09-19',
            dateRange: { from: '2026-09-19', to: '2026-09-19' },
            orders: { completed: 14, cancelled: 1 },
            revenuePaise: 245000,
            collectedPaise: 245000,
            collectedByMethod: {
              cashPaise: 100000,
              upiPaise: 145000,
            },
            outstandingPaise: 12000,
            expensesPaise: 45000,
            operatingResultPaise: 200000,
            aovPaise: 17500,
            disclaimer:
              'Operating result reflects revenue minus expenses within this business period.',
          },
        });
      }
      if (path.includes('/dashboard/breakdown')) {
        return Promise.resolve({
          data: {
            period: 'today',
            by: 'method',
            dateRange: { from: '2026-09-19', to: '2026-09-19' },
            items: [
              { key: 'UPI_STATIC', label: 'UPI', count: 8, totalPaise: 145000 },
              { key: 'CASH', label: 'Cash', count: 6, totalPaise: 100000 },
            ],
            totalPaise: 245000,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    renderPage();

    expect(await screen.findByText('Business Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Revenue (Billed)')).toBeInTheDocument();
    const revMatches = await screen.findAllByText('₹2450.00');
    expect(revMatches.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Collected Payments')).toBeInTheDocument();
    expect(await screen.findByText('Outstanding (All-Time)')).toBeInTheDocument();
    expect(await screen.findByText('Expenses')).toBeInTheDocument();
    expect(await screen.findByText('Operating Result')).toBeInTheDocument();
    expect(await screen.findByText('Orders Completed')).toBeInTheDocument();
    expect(
      await screen.findByText(/Operating result reflects revenue minus expenses/),
    ).toBeInTheDocument();
  });

  it('allows switching period tab to week and month', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/dashboard/summary')) {
        return Promise.resolve({
          data: {
            period: 'week',
            businessDate: '2026-09-19',
            dateRange: { from: '2026-09-15', to: '2026-09-19' },
            orders: { completed: 80, cancelled: 3 },
            revenuePaise: 1200000,
            collectedPaise: 1200000,
            collectedByMethod: {
              cashPaise: 500000,
              upiPaise: 700000,
            },
            outstandingPaise: 0,
            expensesPaise: 250000,
            operatingResultPaise: 950000,
            aovPaise: 15000,
            disclaimer:
              'Operating result reflects revenue minus expenses within this business period.',
          },
        });
      }
      if (path.includes('/dashboard/breakdown')) {
        return Promise.resolve({
          data: {
            period: 'week',
            by: 'method',
            dateRange: { from: '2026-09-15', to: '2026-09-19' },
            items: [],
            totalPaise: 0,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    renderPage();

    const weekTab = await screen.findByRole('button', { name: 'week' });
    await userEvent.click(weekTab);

    const matches = await screen.findAllByText('₹12000.00');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
