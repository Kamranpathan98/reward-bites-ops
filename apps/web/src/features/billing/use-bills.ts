import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplyDiscountRequest,
  BillDetailResponse,
  BillStatus,
  BillsListResponse,
  CreateBillRequest,
  DiscardBillRequest,
  FinalizeBillRequest,
  PaymentsListResponse,
  RecordPaymentRequest,
  RecordPaymentResponse,
  VoidBillRequest,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const billsQueryKey = ['bills'] as const;
export const billDetailQueryKey = (id: string) => ['bills', id] as const;
export const billPaymentsQueryKey = (id: string) => ['bills', id, 'payments'] as const;

export function useBills(status?: BillStatus) {
  const qs = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: [...billsQueryKey, 'list', status ?? 'ALL'],
    queryFn: () => apiFetch<BillsListResponse>(`/bills${qs}`),
    refetchInterval: 5000,
  });
}

export function useBill(id: string) {
  return useQuery({
    queryKey: billDetailQueryKey(id),
    queryFn: () => apiFetch<BillDetailResponse>(`/bills/${id}`),
    enabled: Boolean(id),
  });
}

export function useBillPayments(id: string) {
  return useQuery({
    queryKey: billPaymentsQueryKey(id),
    queryFn: () => apiFetch<PaymentsListResponse>(`/bills/${id}/payments`),
    enabled: Boolean(id),
  });
}

/** Any billing change can alter order billed-state and the floor view, so refresh those too. */
function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return (billId?: string) => {
    void queryClient.invalidateQueries({ queryKey: billsQueryKey });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
    if (billId) {
      void queryClient.invalidateQueries({ queryKey: billDetailQueryKey(billId) });
      void queryClient.invalidateQueries({ queryKey: billPaymentsQueryKey(billId) });
    }
  };
}

export function useCreateBill() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: CreateBillRequest) =>
      apiFetch<BillDetailResponse>('/bills', { method: 'POST', body }),
    onSuccess: (data) => invalidate(data.data.id),
  });
}

export function useApplyDiscount(billId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: ApplyDiscountRequest) =>
      apiFetch<BillDetailResponse>(`/bills/${billId}/adjustments`, { method: 'PATCH', body }),
    onSettled: () => invalidate(billId),
  });
}

export function useFinalizeBill(billId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: FinalizeBillRequest) =>
      apiFetch<BillDetailResponse>(`/bills/${billId}/finalize`, { method: 'POST', body }),
    onSettled: () => invalidate(billId),
  });
}

export function useDiscardBill(billId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: DiscardBillRequest) =>
      apiFetch<BillDetailResponse>(`/bills/${billId}/discard`, { method: 'POST', body }),
    onSettled: () => invalidate(billId),
  });
}

export function useVoidBill(billId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: VoidBillRequest) =>
      apiFetch<BillDetailResponse>(`/bills/${billId}/void`, { method: 'POST', body }),
    onSettled: () => invalidate(billId),
  });
}

export function useRecordPayment(billId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: RecordPaymentRequest) =>
      apiFetch<RecordPaymentResponse>('/payments', { method: 'POST', body }),
    onSettled: () => invalidate(billId),
  });
}
