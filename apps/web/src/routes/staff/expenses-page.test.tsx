import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpensesPage } from './expenses-page';

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
        <ExpensesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExpensesPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('renders expenses list and category tab', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/expense-categories')) {
        return Promise.resolve({
          data: [
            {
              id: 'cat-1',
              name: 'Ingredients & Groceries',
              sortOrder: 1,
              isActive: true,
              createdAt: '2026-09-19T00:00:00.000Z',
            },
          ],
        });
      }
      if (path.includes('/expenses')) {
        return Promise.resolve({
          data: [
            {
              id: 'exp-1',
              categoryId: 'cat-1',
              categoryName: 'Ingredients & Groceries',
              amountPaise: 45000,
              expenseDate: '2026-09-19',
              description: 'Fresh Milk & Paneer',
              paymentMethod: 'CASH',
              version: 0,
              createdBy: 'user-1',
              updatedBy: null,
              createdAt: '2026-09-19T00:00:00.000Z',
            },
          ],
          meta: { nextCursor: null },
        });
      }
      return Promise.resolve({ data: [] });
    });

    renderPage();

    expect(await screen.findByText('Expenses & Categories')).toBeInTheDocument();
    expect(await screen.findByText('Fresh Milk & Paneer')).toBeInTheDocument();
    expect(await screen.findByText('₹450.00')).toBeInTheDocument();
  });

  it('switches to Categories tab and lists categories', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/expense-categories')) {
        return Promise.resolve({
          data: [
            {
              id: 'cat-1',
              name: 'Utilities (Gas, Water, Electricity)',
              sortOrder: 6,
              isActive: true,
              createdAt: '2026-09-19T00:00:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve({ data: [], meta: { nextCursor: null } });
    });

    renderPage();

    const catTab = await screen.findByRole('button', { name: 'Categories' });
    await userEvent.click(catTab);

    expect(await screen.findByText('Utilities (Gas, Water, Electricity)')).toBeInTheDocument();
    expect(await screen.findByText('Active')).toBeInTheDocument();
  });
});

