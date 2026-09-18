import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { configureApiClient, trySilentRefresh } from '@/lib/api-client';

interface AuthContextValue {
  /** In memory only — never localStorage/sessionStorage (architecture section 14). */
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  /** True while the boot-time session-restore attempt is in flight. */
  isRestoringSession: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const tokenRef = useRef<string | null>(null);

  const setAccessToken = (token: string | null): void => {
    tokenRef.current = token;
    setAccessTokenState(token);
  };

  useEffect(() => {
    configureApiClient(
      () => tokenRef.current,
      (token) => setAccessToken(token),
    );

    // The access token is memory-only, so a fresh page load has none — try
    // the HttpOnly refresh cookie once before deciding the user is logged out.
    let cancelled = false;
    void trySilentRefresh().finally(() => {
      if (!cancelled) setIsRestoringSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ accessToken, setAccessToken, isRestoringSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within an AuthProvider');
  return ctx;
}
