import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateAddonRequest,
  CreateCategoryRequest,
  CreateItemRequest,
  CreateVariantRequest,
  MenuTreeResponse,
  PatchAddonRequest,
  PatchCategoryRequest,
  PatchItemRequest,
  PatchVariantRequest,
  ReorderRequest,
  UpdateAvailabilityRequest,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const menuQueryKey = ['menu'] as const;

export function useMenu() {
  return useQuery({
    queryKey: menuQueryKey,
    queryFn: () => apiFetch<MenuTreeResponse>('/menu'),
  });
}

function useInvalidateMenu() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: menuQueryKey });
}

// ---- categories ---------------------------------------------------

export function useCreateCategory() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) =>
      apiFetch<{ data: { id: string } }>('/menu/categories', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchCategory() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchCategoryRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/menu/categories/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: true }>(`/menu/categories/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

// ---- items ----------------------------------------------------------

export function useCreateItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (body: CreateItemRequest) =>
      apiFetch<{ data: { id: string } }>('/menu/items', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchItemRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/menu/items/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ data: true }>(`/menu/items/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUpdateItemAvailability() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, isAvailable }: UpdateAvailabilityRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/menu/items/${id}/availability`, {
        method: 'PATCH',
        body: { isAvailable },
      }),
    onSuccess: invalidate,
  });
}

// ---- variants ---------------------------------------------------

export function useCreateVariant() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (body: CreateVariantRequest) =>
      apiFetch<{ data: { id: string } }>('/menu/variants', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchVariant() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchVariantRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/menu/variants/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteVariant() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: true }>(`/menu/variants/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUpdateVariantAvailability() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, isAvailable }: UpdateAvailabilityRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/menu/variants/${id}/availability`, {
        method: 'PATCH',
        body: { isAvailable },
      }),
    onSuccess: invalidate,
  });
}

// ---- addons -------------------------------------------------------

export function useCreateAddon() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (body: CreateAddonRequest) =>
      apiFetch<{ data: { id: string } }>('/menu/addons', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchAddon() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchAddonRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/menu/addons/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteAddon() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: true }>(`/menu/addons/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

// ---- reorder --------------------------------------------------------

export function useReorderMenu() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (body: ReorderRequest) =>
      apiFetch<{ data: true }>('/menu/reorder', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}
