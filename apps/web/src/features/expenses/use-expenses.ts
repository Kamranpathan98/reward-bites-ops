import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateExpenseCategoryRequest,
  CreateExpenseRequest,
  ExpenseCategory,
  ExpenseCategoryListResponse,
  ExpenseDetailResponse,
  ExpensesListResponse,
  ListExpensesQuery,
  UpdateExpenseCategoryRequest,
  UpdateExpenseRequest,
} from '@rewardbite/contracts';
import { apiFetch } from '@/lib/api-client';

export const expensesQueryKey = ['expenses'] as const;
export const expenseCategoriesQueryKey = ['expense-categories'] as const;

export function useExpenseCategories(includeInactive = false) {
  const qs = includeInactive ? '?includeInactive=true' : '';
  return useQuery({
    queryKey: [...expenseCategoriesQueryKey, includeInactive ? 'all' : 'active'],
    queryFn: () => apiFetch<ExpenseCategoryListResponse>(`/expense-categories${qs}`),
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpenseCategoryRequest) =>
      apiFetch<{ data: ExpenseCategory }>('/expense-categories', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expenseCategoriesQueryKey });
    },
  });
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateExpenseCategoryRequest }) =>
      apiFetch<{ data: ExpenseCategory }>(`/expense-categories/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expenseCategoriesQueryKey });
    },
  });
}

export function useDeleteExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/expense-categories/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expenseCategoriesQueryKey });
    },
  });
}

export function useExpenses(query: ListExpensesQuery) {
  const params = new URLSearchParams();
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: [...expensesQueryKey, 'list', query],
    queryFn: () => apiFetch<ExpensesListResponse>(`/expenses${qs}`),
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpenseRequest) =>
      apiFetch<ExpenseDetailResponse>('/expenses', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateExpenseRequest }) =>
      apiFetch<ExpenseDetailResponse>(`/expenses/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/expenses/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

