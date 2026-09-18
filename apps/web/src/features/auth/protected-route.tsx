import { Navigate, Outlet } from 'react-router-dom';
import { useAuthContext } from './auth-context';

/**
 * Authenticated route guard (task instruction section 11). A deep link
 * without a session redirects to login — the backend remains the real
 * authority; this only avoids rendering a screen that would just 401.
 */
export function ProtectedRoute(): JSX.Element {
  const { accessToken, isRestoringSession } = useAuthContext();

  if (isRestoringSession) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/app/login" replace />;
  }

  return <Outlet />;
}
