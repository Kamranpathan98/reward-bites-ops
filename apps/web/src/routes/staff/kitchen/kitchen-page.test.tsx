import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitchenOrderTicketView } from '@rewardbite/contracts';
import { KitchenPage } from './kitchen-page';

let mockPermissions: string[] = ['kitchen.read', 'orders.transition.kitchen'];

vi.mock('@/features/auth/use-auth', () => ({
  useMe: () => ({
    data: {
      user: { id: 'user-1', email: 'chef@example.com', fullName: 'Chef Sanjeev' },
      tenant: { id: 'tenant-1', name: 'Spice Garden', slug: 'spice-garden' },
      membership: { id: 'm-1', roleName: 'Kitchen Staff' },
      permissions: mockPermissions,
    },
  }),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);

const mockTickets: KitchenOrderTicketView[] = [
  {
    id: 'order-1',
    orderNumber: '#0001',
    tableName: 'Table 4',
    customerName: 'Aarav',
    source: 'QR_DINE_IN',
    type: 'DINE_IN',
    status: 'NEW',
    version: 0,
    placedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    acceptedAt: null,
    readyAt: null,
    notes: 'Mild spicy',
    isEdited: false,
    editReason: null,
    lines: [
      {
        id: 'line-1',
        itemName: 'Paneer Butter Masala',
        variantName: 'Full',
        qty: 1,
        notes: null,
        status: 'ACTIVE',
        addons: [{ addonId: 'add-1', nameSnapshot: 'Extra Butter', qty: 1 }],
      },
    ],
  },
  {
    id: 'order-2',
    orderNumber: '#0002',
    tableName: 'Table 2',
    customerName: null,
    source: 'COUNTER',
    type: 'DINE_IN',
    status: 'ACCEPTED',
    version: 1,
    placedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    acceptedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    readyAt: null,
    notes: null,
    isEdited: true,
    editReason: 'Guest changed roti to naan',
    lines: [
      {
        id: 'line-2',
        itemName: 'Garlic Naan',
        variantName: null,
        qty: 2,
        notes: null,
        status: 'ACTIVE',
        addons: [],
      },
      {
        id: 'line-3',
        itemName: 'Tandoori Roti',
        variantName: null,
        qty: 2,
        notes: null,
        status: 'REMOVED',
        addons: [],
      },
    ],
  },
  {
    id: 'order-3',
    orderNumber: '#0003',
    tableName: 'Takeaway',
    customerName: 'Priya',
    source: 'COUNTER',
    type: 'TAKEAWAY',
    status: 'PREPARING',
    version: 2,
    placedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    acceptedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    readyAt: null,
    notes: null,
    isEdited: false,
    editReason: null,
    lines: [
      {
        id: 'line-4',
        itemName: 'Veg Biryani',
        variantName: null,
        qty: 1,
        notes: null,
        status: 'ACTIVE',
        addons: [],
      },
    ],
  },
  {
    id: 'order-4',
    orderNumber: '#0004',
    tableName: 'Table 7',
    customerName: null,
    source: 'QR_DINE_IN',
    type: 'DINE_IN',
    status: 'READY',
    version: 3,
    placedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    acceptedAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    readyAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    notes: null,
    isEdited: false,
    editReason: null,
    lines: [
      {
        id: 'line-5',
        itemName: 'Cold Coffee',
        variantName: null,
        qty: 2,
        notes: null,
        status: 'ACTIVE',
        addons: [],
      },
    ],
  },
];

function renderKitchenPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <KitchenPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KitchenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions = ['kitchen.read', 'orders.transition.kitchen'];
    apiFetchMock.mockResolvedValue({
      data: [],
      meta: { serverTime: new Date().toISOString() },
    } as unknown as { data: []; meta: { serverTime: string } });
  });

  it('renders swimlane headers and tickets across columns', async () => {
    apiFetchMock.mockResolvedValueOnce({
      data: mockTickets,
      meta: { serverTime: new Date().toISOString() },
    });

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'To Cook (Queue)' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'In Preparation' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Ready at Pass' })).toBeInTheDocument();
    });

    expect(screen.getByText('#0001')).toBeInTheDocument();
    expect(screen.getByText('#0002')).toBeInTheDocument();
    expect(screen.getByText('#0003')).toBeInTheDocument();
    expect(screen.getByText('#0004')).toBeInTheDocument();

    expect(screen.getByText(/Paneer Butter Masala/)).toBeInTheDocument();
    expect(screen.getByText(/Garlic Naan/)).toBeInTheDocument();
    expect(screen.getByText(/Veg Biryani/)).toBeInTheDocument();
    expect(screen.getByText(/Cold Coffee/)).toBeInTheDocument();

    // Removed line shows CANCELLED badge
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
    expect(screen.getByText(/MODIFIED TICKET/)).toBeInTheDocument();
    expect(screen.getByText(/Guest changed roti to naan/)).toBeInTheDocument();
  });

  it('kitchen staff cannot accept NEW order (shows Awaiting Counter Acceptance disabled)', async () => {
    // Kitchen staff role has only kitchen.read and orders.transition.kitchen
    mockPermissions = ['kitchen.read', 'orders.transition.kitchen'];

    apiFetchMock.mockResolvedValueOnce({
      data: [mockTickets[0]], // Order 1 is NEW
      meta: { serverTime: new Date().toISOString() },
    });

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByText('Awaiting Counter Acceptance')).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: 'Awaiting Counter Acceptance' });
    expect(button).toBeDisabled();
  });

  it('front staff (e.g. Cashier) can accept NEW order', async () => {
    // Front staff role has orders.transition.front
    mockPermissions = ['kitchen.read', 'orders.transition.kitchen', 'orders.transition.front'];

    apiFetchMock.mockResolvedValueOnce({
      data: [mockTickets[0]], // Order 1 is NEW
      meta: { serverTime: new Date().toISOString() },
    });

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accept Order' })).toBeInTheDocument();
    });

    apiFetchMock.mockResolvedValueOnce({ data: { ...mockTickets[0], status: 'ACCEPTED' } });

    await userEvent.click(screen.getByRole('button', { name: 'Accept Order' }));

    expect(apiFetchMock).toHaveBeenCalledWith('/orders/order-1/transition', {
      method: 'POST',
      body: { to: 'ACCEPTED', expectedVersion: 0 },
    });
  });

  it('kitchen staff can transition ACCEPTED to PREPARING', async () => {
    mockPermissions = ['kitchen.read', 'orders.transition.kitchen'];

    apiFetchMock.mockResolvedValueOnce({
      data: [mockTickets[1]], // Order 2 is ACCEPTED
      meta: { serverTime: new Date().toISOString() },
    });

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Cooking' })).toBeInTheDocument();
    });

    apiFetchMock.mockResolvedValueOnce({ data: { ...mockTickets[1], status: 'PREPARING' } });

    await userEvent.click(screen.getByRole('button', { name: 'Start Cooking' }));

    expect(apiFetchMock).toHaveBeenCalledWith('/orders/order-2/transition', {
      method: 'POST',
      body: { to: 'PREPARING', expectedVersion: 1 },
    });
  });

  it('kitchen staff can transition PREPARING to READY', async () => {
    mockPermissions = ['kitchen.read', 'orders.transition.kitchen'];

    apiFetchMock.mockResolvedValueOnce({
      data: [mockTickets[2]], // Order 3 is PREPARING
      meta: { serverTime: new Date().toISOString() },
    });

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark Ready' })).toBeInTheDocument();
    });

    apiFetchMock.mockResolvedValueOnce({ data: { ...mockTickets[2], status: 'READY' } });

    await userEvent.click(screen.getByRole('button', { name: 'Mark Ready' }));

    expect(apiFetchMock).toHaveBeenCalledWith('/orders/order-3/transition', {
      method: 'POST',
      body: { to: 'READY', expectedVersion: 2 },
    });
  });

  it('handles 409 VERSION_CONFLICT by displaying notice banner and refreshing', async () => {
    mockPermissions = ['kitchen.read', 'orders.transition.kitchen'];

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/kitchen/orders')) {
        return {
          data: [mockTickets[1]], // Order 2 is ACCEPTED
          meta: { serverTime: new Date().toISOString() },
        };
      }
      if (path.includes('/transition')) {
        throw new ApiError(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: 'This order was changed by someone else.',
              requestId: 'req-1',
              retryable: false,
            },
          },
          409,
        );
      }
      return { data: null };
    });

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Cooking' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Start Cooking' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Docket conflict: another station updated this ticket/),
      ).toBeInTheDocument();
    });
  });

  it('renders feature disabled explanation when kitchen display is not enabled', async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(
        {
          error: {
            code: 'FEATURE_DISABLED',
            message: 'Kitchen display is not enabled for this restaurant.',
            requestId: 'req-2',
            retryable: false,
          },
        },
        403,
      ),
    );

    renderKitchenPage();

    await waitFor(() => {
      expect(screen.getByText('Kitchen Display Disabled')).toBeInTheDocument();
      expect(
        screen.getByText(/Kitchen Display is not enabled for this restaurant/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to Orders' })).toBeInTheDocument();
    });
  });
});
