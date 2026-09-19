import { useQuery } from '@tanstack/react-query';
import type {
  DashboardBreakdownQuery,
  DashboardBreakdownResponse,
  DashboardQuery,
  DashboardSummaryResponse,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const dashboardQueryKey = ['dashboard'] as const;

export function useDashboardSummary(query: DashboardQuery) {
  const params = new URLSearchParams();
  if (query.period) params.set('period', query.period);
  if (query.date) params.set('date', query.date);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: [...dashboardQueryKey, 'summary', query],
    queryFn: () => apiFetch<DashboardSummaryResponse>(`/dashboard/summary${qs}`),
    refetchInterval: 10000,
  });
}

export function useDashboardBreakdown(query: DashboardBreakdownQuery) {
  const params = new URLSearchParams();
  if (query.period) params.set('period', query.period);
  if (query.by) params.set('by', query.by);
  if (query.date) params.set('date', query.date);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: [...dashboardQueryKey, 'breakdown', query],
    queryFn: () => apiFetch<DashboardBreakdownResponse>(`/dashboard/breakdown${qs}`),
  });
}

