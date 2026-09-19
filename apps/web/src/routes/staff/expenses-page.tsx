import { useState } from 'react';
import type { ExpensePaymentMethod, ExpenseSummary } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPaise, rupeesToPaise } from '@/features/billing/bill-format';
import {
  useCreateExpense,
  useCreateExpenseCategory,
  useDeleteExpense,
  useDeleteExpenseCategory,
  useExpenseCategories,
  useExpenses,
  useUpdateExpense,
  useUpdateExpenseCategory,
} from '@/features/expenses/use-expenses';

const PAYMENT_METHODS: ExpensePaymentMethod[] = [
  'CASH',
  'UPI',
  'BANK_TRANSFER',
  'CARD',
  'OTHER',
];

export function ExpensesPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'expenses' | 'categories'>('expenses');

  // Filter state
  const [categoryId, setCategoryId] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<ExpenseSummary | null>(null);
  const [createCatOpen, setCreateCatOpen] = useState(false);

  const categoriesQuery = useExpenseCategories(true);
  const expensesQuery = useExpenses({
    categoryId: categoryId || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 50,
  });

  const createExpenseMutation = useCreateExpense();
  const updateExpenseMutation = useUpdateExpense();
  const deleteExpenseMutation = useDeleteExpense();

  const createCatMutation = useCreateExpenseCategory();
  const updateCatMutation = useUpdateExpenseCategory();
  const deleteCatMutation = useDeleteExpenseCategory();

  // Fresh idempotency key generated per modal open
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  const openCreateModal = () => {
    setIdempotencyKey(crypto.randomUUID());
    setCreateOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Expenses & Categories</h1>
          <p className="text-sm text-muted-foreground">
            Track day-to-day restaurant purchases, ingredient supplies, utilities, and maintain categories.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'expenses' && (
            <Button size="sm" onClick={openCreateModal}>
              + Record Expense
            </Button>
          )}
          {activeTab === 'categories' && (
            <Button size="sm" onClick={() => setCreateCatOpen(true)}>
              + Add Category
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-4">
        <button
          type="button"
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'expenses'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('expenses')}
        >
          Expenses
        </button>
        <button
          type="button"
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'categories'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('categories')}
        >
          Categories
        </button>
      </div>

      {/* EXPENSES TAB */}
      {activeTab === 'expenses' && (
        <div className="flex flex-col gap-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 bg-muted/40 p-3 rounded-lg text-sm">
            <div className="flex items-center gap-2">
              <label htmlFor="filter-cat" className="font-medium text-muted-foreground">
                Category:
              </label>
              <select
                id="filter-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="border border-border rounded px-2 py-1 bg-background text-foreground"
              >
                <option value="">All categories</option>
                {categoriesQuery.data?.data.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="filter-from" className="font-medium text-muted-foreground">
                From:
              </label>
              <input
                id="filter-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-border rounded px-2 py-1 bg-background text-foreground"
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="filter-to" className="font-medium text-muted-foreground">
                To:
              </label>
              <input
                id="filter-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-border rounded px-2 py-1 bg-background text-foreground"
              />
            </div>

            {(categoryId || from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryId('');
                  setFrom('');
                  setTo('');
                }}
              >
                Reset
              </Button>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recorded Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              {expensesQuery.isLoading && <p className="text-muted-foreground">Loading expenses…</p>}
              {expensesQuery.isError && (
                <div className="flex items-center gap-3">
                  <p className="text-red-600">Could not load expenses.</p>
                  <Button size="sm" variant="outline" onClick={() => void expensesQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {expensesQuery.data && expensesQuery.data.data.length === 0 && (
                <p className="text-muted-foreground">No expenses recorded yet.</p>
              )}
              {expensesQuery.data && expensesQuery.data.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Category</th>
                        <th className="py-2 pr-4 font-medium">Description</th>
                        <th className="py-2 pr-4 font-medium">Method</th>
                        <th className="py-2 pr-4 font-medium text-right">Amount</th>
                        <th className="py-2 pl-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expensesQuery.data.data.map((item) => (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 pr-4 whitespace-nowrap">{item.expenseDate}</td>
                          <td className="py-2 pr-4 font-medium">{item.categoryName}</td>
                          <td className="py-2 pr-4 max-w-xs truncate" title={item.description}>
                            {item.description}
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                            {item.paymentMethod}
                          </td>
                          <td className="py-2 pr-4 text-right font-medium whitespace-nowrap">
                            {formatPaise(item.amountPaise)}
                          </td>
                          <td className="py-2 pl-4 text-right whitespace-nowrap space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditExpense(item)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => {
                                if (window.confirm('Delete this expense?')) {
                                  deleteExpenseMutation.mutate(item.id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* CATEGORIES TAB */}
      {activeTab === 'categories' && (
        <Card>
          <CardHeader>
            <CardTitle>Expense Categories</CardTitle>
          </CardHeader>
          <CardContent>
            {categoriesQuery.isLoading && <p className="text-muted-foreground">Loading categories…</p>}
            {categoriesQuery.isError && (
              <div className="flex items-center gap-3">
                <p className="text-red-600">Could not load categories.</p>
                <Button size="sm" variant="outline" onClick={() => void categoriesQuery.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            {categoriesQuery.data && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium">Sort Order</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pl-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoriesQuery.data.data.map((cat) => (
                      <tr key={cat.id} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-medium">{cat.name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{cat.sortOrder}</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs rounded font-medium ${
                              cat.isActive
                                ? 'bg-emerald-500/10 text-emerald-600'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {cat.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2 pl-4 text-right space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const newName = window.prompt('Category name:', cat.name);
                              if (newName && newName.trim() !== cat.name) {
                                updateCatMutation.mutate({
                                  id: cat.id,
                                  body: { name: newName.trim() },
                                });
                              }
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              updateCatMutation.mutate({
                                id: cat.id,
                                body: { isActive: !cat.isActive },
                              });
                            }}
                          >
                            {cat.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => {
                              if (window.confirm(`Delete category "${cat.name}"?`)) {
                                deleteCatMutation.mutate(cat.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CREATE EXPENSE MODAL */}
      {createOpen && (
        <CreateExpenseModal
          idempotencyKey={idempotencyKey}
          categories={categoriesQuery.data?.data.filter((c) => c.isActive) ?? []}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (payload) => {
            await createExpenseMutation.mutateAsync(payload);
            setCreateOpen(false);
          }}
          isSubmitting={createExpenseMutation.isPending}
          error={createExpenseMutation.error ? String(createExpenseMutation.error) : null}
        />
      )}

      {/* EDIT EXPENSE MODAL */}
      {editExpense && (
        <EditExpenseModal
          expense={editExpense}
          categories={categoriesQuery.data?.data ?? []}
          onClose={() => setEditExpense(null)}
          onSubmit={async (payload) => {
            await updateExpenseMutation.mutateAsync({
              id: editExpense.id,
              body: payload,
            });
            setEditExpense(null);
          }}
          isSubmitting={updateExpenseMutation.isPending}
          error={updateExpenseMutation.error ? String(updateExpenseMutation.error) : null}
        />
      )}

      {/* CREATE CATEGORY MODAL */}
      {createCatOpen && (
        <CreateCategoryModal
          onClose={() => setCreateCatOpen(false)}
          onSubmit={async (payload) => {
            await createCatMutation.mutateAsync(payload);
            setCreateCatOpen(false);
          }}
          isSubmitting={createCatMutation.isPending}
          error={createCatMutation.error ? String(createCatMutation.error) : null}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Modals
// -----------------------------------------------------------------------------

function CreateExpenseModal({
  idempotencyKey,
  categories,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  idempotencyKey: string;
  categories: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (payload: {
    idempotencyKey: string;
    categoryId: string;
    amountPaise: number;
    expenseDate: string;
    description: string;
    paymentMethod: ExpensePaymentMethod;
  }) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [catId, setCatId] = useState(categories[0]?.id ?? '');
  const [rupees, setRupees] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<ExpensePaymentMethod>('CASH');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const paise = rupeesToPaise(rupees);
    if (paise === null || paise <= 0) {
      setValidationError('Please enter a valid positive amount in Rupees.');
      return;
    }
    if (!catId) {
      setValidationError('Please select a category.');
      return;
    }
    if (!desc.trim()) {
      setValidationError('Please provide a description.');
      return;
    }

    void onSubmit({
      idempotencyKey,
      categoryId: catId,
      amountPaise: paise,
      expenseDate: date,
      description: desc.trim(),
      paymentMethod: method,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-background border border-border rounded-lg max-w-md w-full p-6 shadow-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Record Expense</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        {(error || validationError) && (
          <div className="bg-red-500/10 text-red-600 text-sm p-2 rounded">
            {validationError || error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-sm">
          <div>
            <label className="font-medium">Category</label>
            <select
              value={catId}
              onChange={(e) => setCatId(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-medium">Amount (₹)</label>
            <input
              type="text"
              placeholder="e.g. 250 or 12.50"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="font-medium">Expense Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="font-medium">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as ExpensePaymentMethod)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-medium">Description</label>
            <textarea
              rows={2}
              placeholder="What was this expense for?"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditExpenseModal({
  expense,
  categories,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  expense: ExpenseSummary;
  categories: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (payload: {
    expectedVersion: number;
    categoryId?: string;
    amountPaise?: number;
    expenseDate?: string;
    description?: string;
    paymentMethod?: ExpensePaymentMethod;
  }) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [catId, setCatId] = useState(expense.categoryId);
  const [rupees, setRupees] = useState((expense.amountPaise / 100).toFixed(2));
  const [date, setDate] = useState(expense.expenseDate);
  const [desc, setDesc] = useState(expense.description);
  const [method, setMethod] = useState<ExpensePaymentMethod>(expense.paymentMethod);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const paise = rupeesToPaise(rupees);
    if (paise === null || paise <= 0) {
      setValidationError('Please enter a valid positive amount in Rupees.');
      return;
    }

    void onSubmit({
      expectedVersion: expense.version,
      categoryId: catId,
      amountPaise: paise,
      expenseDate: date,
      description: desc.trim(),
      paymentMethod: method,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-background border border-border rounded-lg max-w-md w-full p-6 shadow-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit Expense</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        {(error || validationError) && (
          <div className="bg-red-500/10 text-red-600 text-sm p-2 rounded">
            {validationError || error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-sm">
          <div>
            <label className="font-medium">Category</label>
            <select
              value={catId}
              onChange={(e) => setCatId(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-medium">Amount (₹)</label>
            <input
              type="text"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="font-medium">Expense Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="font-medium">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as ExpensePaymentMethod)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-medium">Description</label>
            <textarea
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateCategoryModal({
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (payload: { name: string; sortOrder?: number }) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('10');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (!name.trim()) {
      setValidationError('Category name is required.');
      return;
    }
    void onSubmit({
      name: name.trim(),
      sortOrder: Number(sortOrder) || 10,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-background border border-border rounded-lg max-w-sm w-full p-6 shadow-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Category</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        {(error || validationError) && (
          <div className="bg-red-500/10 text-red-600 text-sm p-2 rounded">
            {validationError || error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-sm">
          <div>
            <label className="font-medium">Name</label>
            <input
              type="text"
              placeholder="e.g. Marketing"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="font-medium">Sort Order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full border border-border rounded p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create Category'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

