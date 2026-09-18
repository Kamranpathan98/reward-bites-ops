import { useState } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { createTableRequestSchema, type CreateTableRequest } from '@rewardbite/contracts';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { Can } from '@/features/auth/can';
import {
  useCreateTable,
  useDeleteTable,
  usePatchTable,
  useTables,
  useTablesLive,
} from '@/features/tables/use-tables';

export function TablesPage(): JSX.Element {
  const tablesQuery = useTables();
  const liveQuery = useTablesLive();

  const openSessionByTable = new Map(
    (liveQuery.data?.data ?? []).map((t) => [t.id, t.openSession]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tables</h1>
        <Can permission="tables.read">
          <Link to="/app/tables/qr" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            QR sheet
          </Link>
        </Can>
      </div>

      <Can permission="tables.manage">
        <CreateTableForm />
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>All tables</CardTitle>
        </CardHeader>
        <CardContent>
          {tablesQuery.isLoading && <p className="text-muted-foreground">Loading tables…</p>}

          {tablesQuery.isError && (
            <div className="flex items-center gap-3">
              <p className="text-red-600">Could not load tables.</p>
              <Button size="sm" variant="outline" onClick={() => void tablesQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {tablesQuery.data && tablesQuery.data.data.length === 0 && (
            <p className="text-muted-foreground">No tables yet. Add one above.</p>
          )}

          {tablesQuery.data && tablesQuery.data.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Capacity</th>
                  <th className="py-2 pr-4 font-medium">QR</th>
                  <th className="py-2 pr-4 font-medium">Session</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <Can permission="tables.manage">
                    <th className="py-2 pr-4 font-medium">Actions</th>
                  </Can>
                </tr>
              </thead>
              <tbody>
                {tablesQuery.data.data.map((table) => (
                  <TableRow
                    key={table.id}
                    table={table}
                    openSession={openSessionByTable.get(table.id) ?? null}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TableRow({
  table,
  openSession,
}: {
  table: {
    id: string;
    name: string;
    capacity: number | null;
    isActive: boolean;
    hasActiveQr: boolean;
  };
  openSession: { id: string } | null;
}): JSX.Element {
  const patchTable = usePatchTable();
  const deleteTable = useDeleteTable();
  const [rowError, setRowError] = useState<string | null>(null);

  const handleToggleActive = (): void => {
    setRowError(null);
    patchTable.mutate(
      { id: table.id, isActive: !table.isActive },
      { onError: (error) => setRowError(describeError(error)) },
    );
  };

  const handleDelete = (): void => {
    setRowError(null);
    deleteTable.mutate(table.id, { onError: (error) => setRowError(describeError(error)) });
  };

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-4">{table.name}</td>
      <td className="py-2 pr-4">{table.capacity ?? '—'}</td>
      <td className="py-2 pr-4">
        <Badge variant={table.hasActiveQr ? 'default' : 'secondary'}>
          {table.hasActiveQr ? 'Issued' : 'None'}
        </Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge variant={openSession ? 'default' : 'secondary'}>
          {openSession ? 'Open' : 'Free'}
        </Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge variant={table.isActive ? 'default' : 'secondary'}>
          {table.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </td>
      <Can permission="tables.manage">
        <td className="py-2 pr-4">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleToggleActive}
              disabled={patchTable.isPending}
            >
              {table.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDelete}
              disabled={deleteTable.isPending || Boolean(openSession)}
              title={openSession ? 'This table has an open session' : undefined}
            >
              Delete
            </Button>
          </div>
          {rowError && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {rowError}
            </p>
          )}
        </td>
      </Can>
    </tr>
  );
}

function CreateTableForm(): JSX.Element {
  const createTable = useCreateTableWithReset();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a table</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={createTable.onSubmit}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-name">Name</Label>
            <Input
              id="table-name"
              {...createTable.register('name')}
              aria-invalid={Boolean(createTable.errors.name)}
            />
            {createTable.errors.name && (
              <p className="text-sm text-red-600">{createTable.errors.name.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-capacity">Capacity</Label>
            <Input
              id="table-capacity"
              type="number"
              min={1}
              {...createTable.register('capacity', { valueAsNumber: true })}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-2 lg:self-end">
            {createTable.mutation.error && (
              <p role="alert" className="mb-2 text-sm text-red-600">
                {describeError(createTable.mutation.error)}
              </p>
            )}
            <Button type="submit" disabled={createTable.mutation.isPending}>
              {createTable.mutation.isPending ? 'Adding…' : 'Add table'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function useCreateTableWithReset() {
  const mutation = useCreateTable();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTableRequest>({ resolver: zodResolver(createTableRequestSchema) });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values, { onSuccess: () => reset() });
  });

  return { register, errors, onSubmit, mutation };
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
