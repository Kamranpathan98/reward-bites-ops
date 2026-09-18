import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTableRequest,
  PatchTableRequest,
  RegenerateQrResponse,
  TablesListResponse,
  TablesLiveResponse,
} from '@rewardbite/contracts';
import { apiFetch, apiFetchBlob } from '@/lib/api-client';

export const tablesQueryKey = ['tables'] as const;
export const tablesLiveQueryKey = ['tables', 'live'] as const;

export function useTables() {
  return useQuery({
    queryKey: tablesQueryKey,
    queryFn: () => apiFetch<TablesListResponse>('/tables'),
  });
}

export function useTablesLive() {
  return useQuery({
    queryKey: tablesLiveQueryKey,
    queryFn: () => apiFetch<TablesLiveResponse>('/tables/live'),
    refetchInterval: 4000,
  });
}

export function useCreateTable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTableRequest) =>
      apiFetch<{ data: { id: string } }>('/tables', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tablesQueryKey }),
  });
}

export function usePatchTable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchTableRequest & { id: string }) =>
      apiFetch<{ data: true }>(`/tables/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tablesQueryKey }),
  });
}

export function useDeleteTable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ data: true }>(`/tables/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tablesQueryKey }),
  });
}

export function useRegenerateQr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: RegenerateQrResponse['data'] }>(`/tables/${id}/qr/regenerate`, {
        method: 'POST',
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tablesQueryKey }),
  });
}

export function fetchQrSvgBlob(id: string): Promise<Blob> {
  return apiFetchBlob(`/tables/${id}/qr.svg`);
}

export function fetchQrSheetPdfBlob(): Promise<Blob> {
  return apiFetchBlob('/tables/qr-sheet.pdf');
}
