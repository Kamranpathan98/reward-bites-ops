import { errorEnvelopeSchema, type ErrorEnvelope } from '@rewardbite/contracts';

const API_BASE_URL: string = import.meta.env['VITE_API_BASE_URL'] ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  readonly envelope: ErrorEnvelope;
  readonly status: number;

  constructor(envelope: ErrorEnvelope, status: number) {
    super(envelope.error.message);
    this.envelope = envelope;
    this.status = status;
  }

  get code(): string {
    return this.envelope.error.code;
  }
}

type AccessTokenGetter = () => string | null;
type AccessTokenSetter = (token: string | null) => void;

// The auth context (features/auth/auth-context.tsx) wires these in — the
// access token itself lives only in React state/memory, never here or in
// any browser storage (architecture section 14: "access token held in
// memory only").
let getAccessToken: AccessTokenGetter = () => null;
let setAccessToken: AccessTokenSetter = () => undefined;

export function configureApiClient(getter: AccessTokenGetter, setter: AccessTokenSetter): void {
  getAccessToken = getter;
  setAccessToken = setter;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Single-flight silent refresh, per architecture section 8 (auth
 * interceptor refreshes once). Also called directly at app boot — the
 * access token lives only in memory, so a page reload has none, but the
 * HttpOnly refresh cookie may still be valid.
 */
export async function trySilentRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  /** Set on the refresh call itself, to avoid an infinite refresh loop. */
  skipAuthRetry?: boolean;
}

function toApiError(payload: unknown, status: number): ApiError {
  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (parsed.success) return new ApiError(parsed.data, status);
  return new ApiError(
    {
      error: {
        code: status === 0 ? 'NETWORK_ERROR' : 'INTERNAL',
        message:
          status === 0
            ? 'Could not reach the server. Check your connection.'
            : 'Something went wrong.',
        requestId: 'unknown',
        retryable: status === 0,
      },
    },
    status,
  );
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const doFetch = (): Promise<Response> => {
    const token = getAccessToken();
    return fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw toApiError(null, 0);
  }

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await trySilentRefresh();
    if (refreshed) {
      try {
        res = await doFetch();
      } catch {
        throw toApiError(null, 0);
      }
    }
  }

  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // No JSON body; toApiError falls back to a generic envelope.
    }
    throw toApiError(payload, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * For endpoints that return a binary asset (QR SVG/PNG, the QR sheet PDF)
 * rather than a JSON envelope. A plain `<img src>`/`<a href>` can't carry
 * the in-memory bearer token (architecture section 14: access token never
 * in a cookie or storage an `<img>` tag could implicitly send), so callers
 * fetch the blob here and hand the component an object URL instead.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const doFetch = (): Promise<Response> => {
    const token = getAccessToken();
    return fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw toApiError(null, 0);
  }

  if (res.status === 401) {
    const refreshed = await trySilentRefresh();
    if (refreshed) {
      try {
        res = await doFetch();
      } catch {
        throw toApiError(null, 0);
      }
    }
  }

  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // No JSON body; toApiError falls back to a generic envelope.
    }
    throw toApiError(payload, res.status);
  }

  return res.blob();
}
