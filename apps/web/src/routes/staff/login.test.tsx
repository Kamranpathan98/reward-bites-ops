import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-context';
import { LoginPage } from './login';

function renderLogin(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/app/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    // AuthProvider's boot-time silent refresh — simulate "no session".
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
  });

  it('shows validation errors for an empty submit without calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
    // Only the boot-time refresh call happened — no login POST was fired.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.anything(),
    );
  });

  it('shows a loading state while the request is in flight, then an error on 401', async () => {
    const user = userEvent.setup();
    renderLogin();

    let resolveLogin: () => void = () => undefined;
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/login')) {
        return new Promise((resolve) => {
          resolveLogin = () =>
            resolve({
              ok: false,
              status: 401,
              json: async () => ({
                error: {
                  code: 'TOKEN_INVALID',
                  message: 'Incorrect email or password.',
                  requestId: 'r1',
                  retryable: false,
                },
              }),
            } as Response);
        });
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-real-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: /signing in/i })).toBeDisabled();

    resolveLogin();

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('shows a network-error message when fetch itself fails', async () => {
    const user = userEvent.setup();
    renderLogin();

    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/login')) {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-real-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument();
    });
  });
});
