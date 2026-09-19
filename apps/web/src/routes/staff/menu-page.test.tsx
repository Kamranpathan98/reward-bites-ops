import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuPage } from './menu-page';

// Permission-gating itself is covered by can.test.tsx — here, always show
// gated content so the test can focus on menu CRUD behaviour.
vi.mock('@/features/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from '@/lib/api-client';

const apiFetchMock = vi.mocked(apiFetch);

const CATEGORY_ID = '01a0b0c6-8866-72c2-8fc2-b62bd4d27923';
const ITEM_ID = '01a0b0c6-886c-7000-8000-000000000001';

const emptyMenu = { data: { categories: [], addons: [] } };

const menuWithItem = {
  data: {
    categories: [
      {
        id: CATEGORY_ID,
        name: 'Starters',
        sortOrder: 0,
        isActive: true,
        items: [
          {
            id: ITEM_ID,
            categoryId: CATEGORY_ID,
            name: 'Spring Rolls',
            description: null,
            imageKey: null,
            basePricePaise: 15000,
            isAvailable: true,
            isActive: true,
            sortOrder: 0,
            vegFlag: 'VEG',
            variants: [],
            addons: [],
          },
        ],
      },
    ],
    addons: [],
  },
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MenuPage />
    </QueryClientProvider>,
  );
}

describe('MenuPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('shows a loading state, then an empty state', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(emptyMenu);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();
    expect(screen.getByText('Loading menu…')).toBeInTheDocument();
    expect(await screen.findByText('No categories yet. Add one above.')).toBeInTheDocument();
  });

  it('shows an error state with a working retry button', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu')
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
    expect(await screen.findByText('Could not load the menu.')).toBeInTheDocument();

    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(menuWithItem);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Spring Rolls')).toBeInTheDocument();
  });

  it('renders a category with its item, price, and badges', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(menuWithItem);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderPage();

    expect(await screen.findByText('Starters')).toBeInTheDocument();
    expect(screen.getByText('Spring Rolls')).toBeInTheDocument();
    expect(screen.getByText('₹150.00')).toBeInTheDocument();
    expect(screen.getByText('VEG')).toBeInTheDocument();
  });

  it('submits the create-category form with the validated payload', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu' && (!options || options.method === undefined))
        return Promise.resolve(emptyMenu);
      if (path === '/menu/categories' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-category-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No categories yet. Add one above.');

    // The empty-menu state also renders the add-on catalog's own "Name"
    // field; the category form's comes first in DOM order.
    const [categoryNameInput] = screen.getAllByLabelText('Name');
    await user.type(categoryNameInput as HTMLElement, 'Mains');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/menu/categories',
        expect.objectContaining({ method: 'POST', body: { name: 'Mains' } }),
      );
    });
  });

  it('toggles item availability via the row action', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu') return Promise.resolve(menuWithItem);
      if (path === `/menu/items/${ITEM_ID}/availability` && options?.method === 'PATCH')
        return Promise.resolve({ data: true });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Rolls');

    await user.click(screen.getByRole('button', { name: 'Mark unavailable' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/menu/items/${ITEM_ID}/availability`,
        expect.objectContaining({ method: 'PATCH', body: { isAvailable: false } }),
      );
    });
  });

  it('shows a mutation error when deleting an item fails', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu') return Promise.resolve(menuWithItem);
      if (path === `/menu/items/${ITEM_ID}` && options?.method === 'DELETE')
        return Promise.reject(
          new ApiError(
            {
              error: {
                code: 'CONFLICT',
                message: 'Cannot delete this item.',
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
    await screen.findByText('Spring Rolls');

    await user.click(screen.getByRole('button', { name: 'Delete item' }));

    expect(await screen.findByText('Cannot delete this item.')).toBeInTheDocument();
  });

  it('submits item with INR rupees converted to integer paise in payload (120 -> 12000)', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu' && (!options || options.method === undefined))
        return Promise.resolve(menuWithItem);
      if (path === '/menu/items' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-item-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Rolls');

    // Verify label says (₹) not (paise)
    expect(screen.getByLabelText('Base price (₹)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/base price \(paise\)/i)).not.toBeInTheDocument();

    const [nameInput] = screen.getAllByLabelText('Item name');
    await user.type(nameInput as HTMLElement, 'Garlic Bread');

    const priceInput = screen.getByLabelText('Base price (₹)');
    await user.type(priceInput, '120');

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/menu/items',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            name: 'Garlic Bread',
            basePricePaise: 12000,
          }),
        }),
      );
    });
  });

  it('submits item with fractional INR rupees correctly converted to paise (120.50 -> 12050)', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu' && (!options || options.method === undefined))
        return Promise.resolve(menuWithItem);
      if (path === '/menu/items' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-item-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Rolls');

    const [nameInput] = screen.getAllByLabelText('Item name');
    await user.type(nameInput as HTMLElement, 'Cheese Dip');

    const priceInput = screen.getByLabelText('Base price (₹)');
    await user.type(priceInput, '120.50');

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/menu/items',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            name: 'Cheese Dip',
            basePricePaise: 12050,
          }),
        }),
      );
    });
  });

  it('shows error and blocks submit when invalid price is entered in menu item form', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/menu') return Promise.resolve(menuWithItem);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Rolls');

    const [nameInput] = screen.getAllByLabelText('Item name');
    await user.type(nameInput as HTMLElement, 'Bad Price Item');

    const priceInput = screen.getByLabelText('Base price (₹)');
    await user.type(priceInput, 'abc');

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(await screen.findByText('Enter a valid price, e.g. 120 or 120.50')).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/menu/items', expect.anything());
  });

  it('submits addon with INR rupees converted to integer paise in payload (30.50 -> 3050)', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu' && (!options || options.method === undefined))
        return Promise.resolve(menuWithItem);
      if (path === '/menu/addons' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-addon-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Rolls');

    // Addon price label should say Price (₹)
    expect(screen.getByLabelText('Price (₹)')).toBeInTheDocument();

    const nameInputs = screen.getAllByLabelText('Name');
    // The AddonCatalogCard name input is the second "Name" on page (or only one if category form not rendered)
    const addonNameInput = nameInputs[nameInputs.length - 1];
    await user.type(addonNameInput as HTMLElement, 'Extra Cheese');

    const addonPriceInput = screen.getByLabelText('Price (₹)');
    await user.type(addonPriceInput, '30.50');

    await user.click(screen.getByRole('button', { name: 'Add add-on' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/menu/addons',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            name: 'Extra Cheese',
            pricePaise: 3050,
          }),
        }),
      );
    });
  });

  it('submits variant with INR rupees converted to integer paise in payload (80.00 -> 8000)', async () => {
    apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/menu' && (!options || options.method === undefined))
        return Promise.resolve(menuWithItem);
      if (path === '/menu/variants' && options?.method === 'POST')
        return Promise.resolve({ data: { id: 'new-variant-id' } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Rolls');

    // Click "Add variant" button to reveal form
    await user.click(screen.getByRole('button', { name: 'Add variant' }));

    // Price label should say Price (₹) (both variant and addon forms have this label)
    const [variantPriceInput] = screen.getAllByLabelText('Price (₹)');
    expect(variantPriceInput).toBeInTheDocument();

    const variantNameInput = screen.getByLabelText('Variant name');
    await user.type(variantNameInput, 'Half Plate');
    await user.type(variantPriceInput as HTMLElement, '80.00');

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/menu/variants',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            itemId: ITEM_ID,
            name: 'Half Plate',
            pricePaise: 8000,
          }),
        }),
      );
    });
  });
});
