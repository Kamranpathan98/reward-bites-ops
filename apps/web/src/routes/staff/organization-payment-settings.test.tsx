import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { organizationSettingsQueryKey } from '@/features/settings/use-organization-settings';
import { OrganizationPaymentSettingsPage } from './organization-payment-settings';

vi.mock('@/features/auth/use-auth', () => ({ useMe: vi.fn() }));
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiFetch: vi.fn() };
});

import { useMe } from '@/features/auth/use-auth';
import { apiFetch, ApiError } from '@/lib/api-client';

const meMock = vi.mocked(useMe);
const apiFetchMock = vi.mocked(apiFetch);

const OWNER = ['settings.read', 'settings.payments.manage'];
const MANAGER = ['settings.read'];
const CASHIER = ['orders.read', 'bills.read'];

type Settings = {
  cashEnabled: boolean;
  upiEnabled: boolean;
  upiId: string | null;
  upiReferenceRequired: boolean;
};

const DEFAULTS: Settings = {
  cashEnabled: true,
  upiEnabled: false,
  upiId: null,
  upiReferenceRequired: true,
};

function as(permissions: string[]): void {
  meMock.mockReturnValue({ data: { permissions }, isLoading: false } as never);
}

function serverHolds(settings: Settings): void {
  apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path !== '/organization/settings') return Promise.reject(new Error(`unexpected ${path}`));
    if (opts?.method === 'PATCH') {
      return Promise.resolve({ data: { ...settings, ...(opts.body as object) } });
    }
    return Promise.resolve({ data: settings });
  });
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationPaymentSettingsPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

const cash = (): HTMLElement => screen.getByRole('checkbox', { name: /cash/i });
const upi = (): HTMLElement => screen.getByRole('checkbox', { name: /^upi payments/i });
const utr = (): HTMLElement => screen.getByRole('checkbox', { name: /utr/i });
const upiId = (): HTMLElement => screen.getByLabelText(/^upi id/i);
const save = (): HTMLElement | null => screen.queryByRole('button', { name: /save changes/i });
const patchCalls = (): unknown[][] =>
  apiFetchMock.mock.calls.filter(
    ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PATCH',
  );

describe('OrganizationPaymentSettingsPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    meMock.mockReset();
  });

  it('shows a loading state while the settings load', () => {
    as(OWNER);
    apiFetchMock.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    expect(screen.getByText(/loading payment settings/i)).toBeInTheDocument();
  });

  it('shows a retryable error when the settings cannot be loaded', async () => {
    as(OWNER);
    apiFetchMock.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);

    serverHolds(DEFAULTS);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('checkbox', { name: /cash/i })).toBeInTheDocument();
  });

  it('says the account could not be loaded (not "no access") when /auth/me fails, and requests nothing', () => {
    meMock.mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load your account/i);
    expect(screen.queryByText(/don.t have access/i)).not.toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  describe('a user without settings.read', () => {
    it('gets a no-access message and the settings are never requested', () => {
      as(CASHIER);
      renderPage();
      expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
      expect(apiFetchMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });

  describe('Manager (settings.read only) — read-only', () => {
    beforeEach(() => {
      as(MANAGER);
      serverHolds({
        cashEnabled: true,
        upiEnabled: false,
        upiId: 'shop@upi',
        upiReferenceRequired: true,
      });
    });

    it('sees every current value, including a stored UPI ID while UPI is off', async () => {
      renderPage();
      expect(await screen.findByRole('checkbox', { name: /cash/i })).toBeChecked();
      expect(upi()).not.toBeChecked();
      expect(utr()).toBeChecked();
      expect(upiId()).toHaveValue('shop@upi');
    });

    it('cannot edit: every control is disabled/read-only, there is no Save button, and it says why', async () => {
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      for (const box of [cash(), upi(), utr()]) expect(box).toBeDisabled();
      expect(upiId()).toHaveAttribute('readonly');
      expect(save()).not.toBeInTheDocument();
      expect(screen.getByText(/don.t have permission to change/i)).toBeInTheDocument();
    });
  });

  describe('Owner (settings.payments.manage) — editable', () => {
    beforeEach(() => as(OWNER));

    it('loads the values into editable controls; Save is disabled until something changes', async () => {
      serverHolds(DEFAULTS);
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      expect(cash()).toBeEnabled();
      expect(save()).toBeDisabled();
      await userEvent.click(utr());
      expect(save()).toBeEnabled();
      await userEvent.click(utr()); // back to the saved value
      expect(save()).toBeDisabled();
    });

    it('PATCHes only the fields that changed, then shows the saved values and a status message', async () => {
      serverHolds(DEFAULTS);
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(utr());
      await userEvent.click(save() as HTMLElement);

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0]).toEqual([
        '/organization/settings',
        { method: 'PATCH', body: { upiReferenceRequired: false } },
      ]);
      expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
      expect(utr()).not.toBeChecked();
      expect(save()).toBeDisabled();
    });

    it('trims the UPI ID it sends and turns UPI on together with the ID', async () => {
      serverHolds(DEFAULTS);
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(upi());
      await userEvent.type(upiId(), '  shop@upi  ');
      await userEvent.click(save() as HTMLElement);
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0]?.[1]).toEqual({
        method: 'PATCH',
        body: { upiEnabled: true, upiId: 'shop@upi' },
      });
    });

    it('turning UPI off sends only upiEnabled — the stored ID is preserved, not re-sent or cleared', async () => {
      serverHolds({
        cashEnabled: true,
        upiEnabled: true,
        upiId: 'shop@upi',
        upiReferenceRequired: true,
      });
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(upi());
      await userEvent.click(save() as HTMLElement);
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0]?.[1]).toEqual({ method: 'PATCH', body: { upiEnabled: false } });
      expect(upiId()).toHaveValue('shop@upi');
    });

    it('blocks turning both methods off, explains it, and sends nothing', async () => {
      serverHolds({
        cashEnabled: true,
        upiEnabled: true,
        upiId: 'shop@upi',
        upiReferenceRequired: true,
      });
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(cash());
      await userEvent.click(upi());
      await userEvent.click(save() as HTMLElement);
      expect(await screen.findByRole('alert')).toHaveTextContent(/at least one payment method/i);
      expect(patchCalls()).toHaveLength(0);
    });

    it('blocks UPI on without an ID, marks the field invalid and links the error to it', async () => {
      serverHolds(DEFAULTS);
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(upi());
      await userEvent.click(save() as HTMLElement);

      const field = upiId();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      const describedBy = field.getAttribute('aria-describedby') ?? '';
      const error = describedBy
        .split(' ')
        .map((id) => document.getElementById(id))
        .find((el) => el?.textContent?.match(/enter a upi id/i));
      expect(error).toBeTruthy();
      expect(patchCalls()).toHaveLength(0);
    });

    it('surfaces a server rejection, keeps what the owner typed, and can be retried', async () => {
      serverHolds(DEFAULTS);
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      apiFetchMock.mockRejectedValueOnce(
        new ApiError(
          {
            error: {
              code: 'PAYMENT_METHOD_REQUIRED',
              message: 'At least one payment method must be enabled.',
              requestId: 'r-1',
              retryable: false,
            },
          },
          422,
        ),
      );
      await userEvent.click(utr());
      await userEvent.click(save() as HTMLElement);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'At least one payment method must be enabled.',
      );
      expect(utr()).not.toBeChecked();
      expect(save()).toBeEnabled();
    });

    it('a field toggled and toggled back does not revert a change someone else made in the meantime', async () => {
      serverHolds(DEFAULTS);
      const queryClient = renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(utr());
      await userEvent.click(utr()); // net effect: no edit
      act(() => {
        queryClient.setQueryData(organizationSettingsQueryKey, {
          data: { ...DEFAULTS, upiReferenceRequired: false },
        });
      });
      await waitFor(() => expect(utr()).not.toBeChecked()); // shows the other admin's value
      expect(save()).toBeDisabled(); // nothing of ours to send
    });

    it.each([
      ['a control character', 'a\u0001b', /control characters/i],
      ['more than 100 characters', 'a'.repeat(101), /at most 100/i],
    ])(
      'rejects a UPI ID with %s inline, using the contract\x27s rule, and sends nothing',
      async (_n, value, message) => {
        serverHolds(DEFAULTS);
        renderPage();
        await screen.findByRole('checkbox', { name: /cash/i });
        fireEvent.change(upiId(), { target: { value } });
        await userEvent.click(save() as HTMLElement);
        expect(upiId()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(patchCalls()).toHaveLength(0);
      },
    );

    it('ties the both-methods-off error to the checkboxes it is about', async () => {
      serverHolds({
        cashEnabled: true,
        upiEnabled: true,
        upiId: 'shop@upi',
        upiReferenceRequired: true,
      });
      renderPage();
      await screen.findByRole('checkbox', { name: /cash/i });
      await userEvent.click(cash());
      await userEvent.click(upi());
      await userEvent.click(save() as HTMLElement);
      for (const box of [cash(), upi()]) {
        const ids = (box.getAttribute('aria-describedby') ?? '').split(' ');
        const linked = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
        expect(linked).toMatch(/at least one payment method/i);
      }
    });
  });
});
