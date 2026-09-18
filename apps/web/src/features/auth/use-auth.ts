import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  SelectTenantResponse,
  SignupRequest,
  SignupResponse,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';
import { useAuthContext } from './auth-context';

export const meQueryKey = ['auth', 'me'] as const;

export function useLogin() {
  const { setAccessToken } = useAuthContext();
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      apiFetch<LoginResponse>('/auth/login', { method: 'POST', body }),
    onSuccess: (data) => setAccessToken(data.accessToken),
  });
}

// Signup auto-logs the owner in (POST /auth/signup returns the exact same
// shape as login — one new tenant, one new membership) — reuses the same
// in-memory access-token wiring as useLogin, never a second auth path.
export function useSignup() {
  const { setAccessToken } = useAuthContext();
  return useMutation({
    mutationFn: (body: SignupRequest) =>
      apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body }),
    onSuccess: (data) => setAccessToken(data.accessToken),
  });
}

export function useSelectTenant() {
  const { setAccessToken } = useAuthContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      apiFetch<SelectTenantResponse>('/auth/select-tenant', {
        method: 'POST',
        body: { membershipId },
      }),
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

export function useLogout() {
  const { setAccessToken } = useAuthContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ data: true }>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setAccessToken(null);
      queryClient.clear();
    },
  });
}

export function useMe() {
  const { accessToken } = useAuthContext();
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => apiFetch<MeResponse>('/auth/me'),
    enabled: accessToken !== null,
    retry: false,
  });
}
