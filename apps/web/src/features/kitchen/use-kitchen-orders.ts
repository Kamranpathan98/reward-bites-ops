import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KitchenOrdersQuery,
  KitchenOrdersResponse,
  OrderDetailResponse,
  TransitionOrderRequest,
} from '@rewardbite/contracts';
import { apiFetch, ApiError } from '@/lib/api-client';

export const kitchenOrdersQueryKey = ['kitchen', 'orders'] as const;

function toQueryString(query?: KitchenOrdersQuery): string {
  if (!query?.status) return '';
  const params = new URLSearchParams();
  const statuses = Array.isArray(query.status) ? query.status : [query.status];
  for (const s of statuses) {
    params.append('status', s);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useKitchenOrders(query?: KitchenOrdersQuery) {
  return useQuery({
    queryKey: [...kitchenOrdersQueryKey, query],
    queryFn: () => apiFetch<KitchenOrdersResponse>(`/kitchen/orders${toQueryString(query)}`),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });
}

export function useKitchenTransition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: TransitionOrderRequest & { id: string }) =>
      apiFetch<OrderDetailResponse>(`/orders/${id}/transition`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: kitchenOrdersQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => {
      // On version conflict, instantly refresh queue to pull the latest version
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: kitchenOrdersQueryKey });
      }
    },
  });
}
