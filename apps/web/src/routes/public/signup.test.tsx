import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-context';
import { SignupPage } from './signup';

function renderSignup(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/signup']}>
          <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/app/setup" element={<div>Setup screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Restaurant name'), 'Ada Diner');
  await user.type(screen.getByLabelText('Your name'), 'Ada Owner');
  await user.type(screen.getByLabelText('Email'), 'ada@example.com');
  await user.type(screen.getByLabelText('Password'), 'a-real-owner-password-123');
  await user.type(screen.getByLabelText('Confirm password'), 'a-real-owner-password-123');
}

describe('SignupPage', () => {
  beforeEach(() => {
    // AuthProvider's boot-time silent refresh — simulate "no session".
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
  });

  it('shows validation errors for an empty submit without calling the API', async () => {
    const user = userEvent.setup();
    renderSignup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/required|invalid/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/signup'),
      expect.anything(),
    );
  });

  it('shows a mismatched-password validation error without calling the API', async () => {
    const user = userEvent.setup();
    renderSignup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await user.type(screen.getByLabelText('Restaurant name'), 'Ada Diner');
    await user.type(screen.getByLabelText('Your name'), 'Ada Owner');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-real-owner-password-123');
    await user.type(screen.getByLabelText('Confirm password'), 'does-not-match-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/signup'),
      expect.anything(),
    );
  });

  it('submits, auto-logs in, and navigates to /app/setup on success', async () => {
    const user = userEvent.setup();
    renderSignup();

    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/signup')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'a-fake-access-token',
            memberships: [
              {
                membershipId: 'm1',
                tenantId: 't1',
                tenantName: 'Ada Diner',
                tenantSlug: 'ada-diner',
                roleName: 'Owner',
              },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Setup screen')).toBeInTheDocument();
  });

  it('shows a clear message when the email is already registered (409)', async () => {
    const user = userEvent.setup();
    renderSignup();

    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/signup')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: 'VERSION_CONFLICT',
              message: 'An account with this email already exists.',
              requestId: 'r1',
              retryable: false,
            },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it('shows a rate-limit message on 429', async () => {
    const user = userEvent.setup();
    renderSignup();

    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/auth/signup')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many signup attempts from this network. Try again later.',
              requestId: 'r1',
              retryable: true,
            },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeInTheDocument();
    });
  });

  it('has a visible link back to the existing sign-in page', () => {
    renderSignup();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/app/login');
  });
});
