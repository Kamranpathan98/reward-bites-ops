import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  OrganizationSettingsResponse,
  PatchOrganizationPaymentSettingsRequest,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const organizationSettingsQueryKey = ['organization', 'settings'] as const;

/** `enabled` is false for users without `settings.read`, so the request is never made for them. */
export function useOrganizationSettings(enabled: boolean) {
  return useQuery({
    queryKey: organizationSettingsQueryKey,
    queryFn: () => apiFetch<OrganizationSettingsResponse>('/organization/settings'),
    enabled,
    retry: false,
  });
}

export function useUpdateOrganizationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchOrganizationPaymentSettingsRequest) =>
      apiFetch<OrganizationSettingsResponse>('/organization/settings', { method: 'PATCH', body }),
    onSuccess: (response) => {
      queryClient.setQueryData(organizationSettingsQueryKey, response);
    },
  });
}
