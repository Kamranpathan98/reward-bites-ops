import { useEffect, useState } from 'react';

/**
 * Fetches a binary asset (via a blob-returning fetcher, e.g.
 * `fetchQrSvgBlob`) and exposes it as an object URL an `<img src>`/`<a
 * href>` can use directly. Revokes the previous URL whenever the blob is
 * replaced or the component unmounts — object URLs are not garbage
 * collected on their own.
 */
export function useObjectUrl(
  fetcher: () => Promise<Blob>,
  deps: readonly unknown[],
): { url: string | null; isLoading: boolean; error: unknown } {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setIsLoading(true);
    setError(null);

    fetcher()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `fetcher` is intentionally excluded from the dependency array — callers
    // pass their own explicit `deps` (the values that should actually
    // trigger a re-fetch), not the fetcher closure itself.
  }, deps);

  return { url, isLoading, error };
}
