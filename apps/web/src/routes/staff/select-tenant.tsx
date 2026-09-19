import { useLocation, useNavigate } from 'react-router-dom';
import type { MembershipSummary } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { useSelectTenant } from '@/features/auth/use-auth';

interface LocationState {
  memberships?: MembershipSummary[];
}

export function SelectTenantPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const memberships = (location.state as LocationState | null)?.memberships ?? [];
  const selectTenant = useSelectTenant();

  // The selected tenant only ever takes effect once the server issues a
  // new tenant-bound JWT (useSelectTenant -> setAccessToken); this page
  // never trusts the membershipId beyond which mutation to fire.
  const handleSelect = (membershipId: string): void => {
    selectTenant.mutate(membershipId, {
      onSuccess: () => navigate('/app', { replace: true }),
    });
  };

  if (memberships.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>No tenant access</CardTitle>
            <CardDescription>
              Your account isn't a member of any restaurant yet. Ask an owner to invite you, or sign
              in again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate('/app/login', { replace: true })}>
              Back to sign in
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose a restaurant</CardTitle>
          <CardDescription>You have access to more than one.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {memberships.map((membership) => (
            <Button
              key={membership.membershipId}
              variant="outline"
              className="justify-between"
              disabled={selectTenant.isPending}
              onClick={() => handleSelect(membership.membershipId)}
            >
              <span>{membership.tenantName}</span>
              <span className="text-muted-foreground">{membership.roleName}</span>
            </Button>
          ))}
          {selectTenant.error && (
            <p role="alert" className="text-sm text-red-600">
              {selectTenant.error instanceof ApiError
                ? selectTenant.error.message
                : 'Could not switch tenants. Please try again.'}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
