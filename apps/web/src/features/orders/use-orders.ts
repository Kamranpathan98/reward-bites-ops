import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelOrderRequest,
  CreateOrderRequest,
  ListOrdersQuery,
  OrderDetailResponse,
  OrdersListResponse,
  PatchOrderLinesRequest,
  ReopenOrderRequest,
  TransitionOrderRequest,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const ordersQueryKey = ['orders'] as const;
export const orderDetailQueryKey = (id: string) => ['orders', id] as const;

function toQueryString(query: ListOrdersQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.status) for (const s of query.status) params.append('status', s);
  if (query.type) params.set('type', query.type);
  if (query.source) params.set('source', query.source);
  if (query.sessionId) params.set('sessionId', query.sessionId);
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useOrders(query?: Pick<ListOrdersQuery, 'status' | 'type'>) {
  return useQuery({
    queryKey: [...ordersQueryKey, query],
    queryFn: () =>
      apiFetch<OrdersListResponse>(`/orders${toQueryString(query as ListOrdersQuery)}`),
    refetchInterval: 5000,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderDetailQueryKey(id),
    queryFn: () => apiFetch<OrderDetailResponse>(`/orders/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ordersQueryKey });
    if (id) void queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(id) });
  };
}

export function useCreateOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (body: CreateOrderRequest) =>
      apiFetch<OrderDetailResponse>('/orders', { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useEditOrderLines() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchOrderLinesRequest & { id: string }) =>
      apiFetch<OrderDetailResponse>(`/orders/${id}/lines`, { method: 'PATCH', body }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useTransitionOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, ...body }: TransitionOrderRequest & { id: string }) =>
      apiFetch<OrderDetailResponse>(`/orders/${id}/transition`, { method: 'POST', body }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useCancelOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, ...body }: CancelOrderRequest & { id: string }) =>
      apiFetch<OrderDetailResponse>(`/orders/${id}/cancel`, { method: 'POST', body }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useReopenOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, ...body }: ReopenOrderRequest & { id: string }) =>
      apiFetch<OrderDetailResponse>(`/orders/${id}/reopen`, { method: 'POST', body }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}
