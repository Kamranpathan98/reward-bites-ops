import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  InviteUserRequest,
  PatchMembershipRequest,
  PermissionsListResponse,
  RolesListResponse,
  UsersListResponse,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const usersQueryKey = ['users'] as const;
export const rolesQueryKey = ['roles'] as const;
export const permissionsQueryKey = ['permissions'] as const;

export function useUsers() {
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: () => apiFetch<UsersListResponse>('/users'),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: rolesQueryKey,
    queryFn: () => apiFetch<RolesListResponse>('/roles'),
  });
}

export function usePermissionsCatalog() {
  return useQuery({
    queryKey: permissionsQueryKey,
    queryFn: () => apiFetch<PermissionsListResponse>('/permissions'),
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteUserRequest) =>
      apiFetch<{ data: { membershipId: string } }>('/users/invite', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  });
}

export function usePatchMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, ...body }: PatchMembershipRequest & { membershipId: string }) =>
      apiFetch<{ data: true }>(`/users/${membershipId}`, { method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  });
}

export function useRevokeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      apiFetch<{ data: true }>(`/users/${membershipId}/sessions`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  });
}
