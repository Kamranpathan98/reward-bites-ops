import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './features/auth/auth-context';

function renderApp(initialPath = '/'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('App routing shell', () => {
  beforeEach(() => {
    // AuthProvider tries a silent refresh on mount; simulate "no session"
    // so tests don't depend on a real backend.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
  });

  it('redirects "/" to the login screen and renders the real login form', async () => {
    renderApp('/');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in to RewardBite' })).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('redirects an unknown path to login too', async () => {
    renderApp('/some/unknown/path');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in to RewardBite' })).toBeInTheDocument();
    });
  });

  it('redirects a protected route to login when there is no session', async () => {
    renderApp('/app/settings/users');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in to RewardBite' })).toBeInTheDocument();
    });
  });
});
