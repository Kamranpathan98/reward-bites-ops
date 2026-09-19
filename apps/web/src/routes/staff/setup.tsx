import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { useCreateTable, useTables } from '@/features/tables/use-tables';

/**
 * First-time setup (docs/IMPLEMENTATION_STATUS.md "Onboarding" section).
 * Deliberately not a multi-step wizard and not a new persistence
 * mechanism: "complete" is derived from real data (at least one table
 * exists, via the Gate 4 endpoint this page already calls) rather than a
 * new onboarding_complete flag — the owner can leave and come back with
 * nothing to lose, because there's no separate state to lose.
 */
export function SetupPage(): JSX.Element {
  const tablesQuery = useTables();
  const createTable = useCreateTable();
  const [tableName, setTableName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError(null);
    if (tableName.trim().length === 0) {
      setFormError('Enter a table name.');
      return;
    }
    createTable.mutate({ name: tableName.trim() }, { onSuccess: () => setTableName('') });
  };

  const hasAtLeastOneTable = (tablesQuery.data?.data.length ?? 0) > 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Let's get your restaurant ready</CardTitle>
          <CardDescription>Just one thing to start: add your first table.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {tablesQuery.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {tablesQuery.isError && <p className="text-red-600">Could not load your tables.</p>}

          {tablesQuery.data && hasAtLeastOneTable && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                You have {tablesQuery.data.data.length} table
                {tablesQuery.data.data.length === 1 ? '' : 's'} set up. You're ready to go.
              </p>
              <div className="flex gap-2">
                <Link to="/app" className={buttonVariants({ className: 'flex-1' })}>
                  Go to dashboard
                </Link>
                <Link
                  to="/app/tables"
                  className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
                >
                  Add more tables
                </Link>
              </div>
            </div>
          )}

          {tablesQuery.data && !hasAtLeastOneTable && (
            <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="setup-table-name">Table name</Label>
                <Input
                  id="setup-table-name"
                  placeholder="Table 1"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              {createTable.error && (
                <p role="alert" className="text-sm text-red-600">
                  {createTable.error instanceof ApiError
                    ? createTable.error.message
                    : 'Could not create the table. Please try again.'}
                </p>
              )}
              <Button type="submit" disabled={createTable.isPending}>
                {createTable.isPending ? 'Adding…' : 'Add table'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
