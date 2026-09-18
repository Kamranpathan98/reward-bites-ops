import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { Can } from '@/features/auth/can';
import { useObjectUrl } from '@/features/tables/use-object-url';
import {
  fetchQrSheetPdfBlob,
  fetchQrSvgBlob,
  useRegenerateQr,
  useTables,
} from '@/features/tables/use-tables';

export function TablesQrPage(): JSX.Element {
  const tablesQuery = useTables();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/app/tables" className="text-sm text-muted-foreground hover:underline">
            ← Tables
          </Link>
          <h1 className="text-xl font-semibold">QR sheet</h1>
        </div>
        <DownloadSheetButton />
      </div>

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
        <p className="text-muted-foreground">No tables yet — add one on the Tables screen first.</p>
      )}

      {tablesQuery.data && tablesQuery.data.data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tablesQuery.data.data.map((table) => (
            <TableQrCard
              key={table.id}
              id={table.id}
              name={table.name}
              hasActiveQr={table.hasActiveQr}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TableQrCard({
  id,
  name,
  hasActiveQr,
}: {
  id: string;
  name: string;
  hasActiveQr: boolean;
}): JSX.Element {
  const regenerateQr = useRegenerateQr();
  const [error, setError] = useState<string | null>(null);
  const { url, isLoading } = useObjectUrl(() => fetchQrSvgBlob(id), [id, hasActiveQr]);

  const handleRegenerate = (): void => {
    setError(null);
    regenerateQr.mutate(id, { onError: (err) => setError(describeError(err)) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div className="flex h-36 w-36 items-center justify-center rounded-md border border-border bg-white">
          {!hasActiveQr && <span className="text-xs text-muted-foreground">No QR yet</span>}
          {hasActiveQr && isLoading && (
            <span className="text-xs text-muted-foreground">Loading…</span>
          )}
          {hasActiveQr && url && (
            <img src={url} alt={`QR code for ${name}`} className="h-32 w-32" />
          )}
        </div>
        <Can permission="tables.manage">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerateQr.isPending}
          >
            {regenerateQr.isPending ? 'Regenerating…' : hasActiveQr ? 'Regenerate' : 'Issue QR'}
          </Button>
        </Can>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DownloadSheetButton(): JSX.Element {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (): Promise<void> => {
    setError(null);
    setIsDownloading(true);
    try {
      const blob = await fetchQrSheetPdfBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'qr-sheet.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleDownload()}
        disabled={isDownloading}
      >
        {isDownloading ? 'Preparing…' : 'Download PDF sheet'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
