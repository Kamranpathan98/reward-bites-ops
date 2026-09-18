import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { inviteUserRequestSchema, type InviteUserRequest } from '@rewardbite/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { Can } from '@/features/auth/can';
import {
  useInviteUser,
  usePatchMembership,
  useRevokeSessions,
  useRoles,
  useUsers,
} from '@/features/users/use-users';

export function UsersPage(): JSX.Element {
  const usersQuery = useUsers();
  const rolesQuery = useRoles();

  return (
    <div className="flex flex-col gap-6">
      <Can permission="users.manage">
        <InviteUserForm roleOptions={rolesQuery.data?.data ?? []} />
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading && <p className="text-muted-foreground">Loading users…</p>}

          {usersQuery.isError && (
            <div className="flex items-center gap-3">
              <p className="text-red-600">Could not load users.</p>
              <Button size="sm" variant="outline" onClick={() => void usersQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {usersQuery.data && usersQuery.data.data.length === 0 && (
            <p className="text-muted-foreground">No users yet.</p>
          )}

          {usersQuery.data && usersQuery.data.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <Can permission="users.manage">
                    <th className="py-2 pr-4 font-medium">Actions</th>
                  </Can>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.data.map((membership) => (
                  <UserRow
                    key={membership.membershipId}
                    membership={membership}
                    roleOptions={rolesQuery.data?.data ?? []}
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

function UserRow({
  membership,
  roleOptions,
}: {
  membership: {
    membershipId: string;
    email: string;
    fullName: string;
    status: string;
    roleId: string;
    roleName: string;
  };
  roleOptions: { id: string; name: string }[];
}): JSX.Element {
  const patchMembership = usePatchMembership();
  const revokeSessions = useRevokeSessions();
  const [rowError, setRowError] = useState<string | null>(null);

  const handleRoleChange = (roleId: string): void => {
    setRowError(null);
    patchMembership.mutate(
      { membershipId: membership.membershipId, roleId },
      { onError: (error) => setRowError(describeError(error)) },
    );
  };

  const handleRevoke = (): void => {
    setRowError(null);
    revokeSessions.mutate(membership.membershipId, {
      onError: (error) => setRowError(describeError(error)),
    });
  };

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-4">{membership.fullName}</td>
      <td className="py-2 pr-4">{membership.email}</td>
      <td className="py-2 pr-4">
        <Can permission="users.manage" fallback={membership.roleName}>
          <Select
            value={membership.roleId}
            onChange={(e) => handleRoleChange(e.target.value)}
            disabled={patchMembership.isPending}
            aria-label={`Role for ${membership.fullName}`}
          >
            {roleOptions.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </Can>
      </td>
      <td className="py-2 pr-4">
        <Badge variant={membership.status === 'ACTIVE' ? 'default' : 'secondary'}>
          {membership.status}
        </Badge>
      </td>
      <Can permission="users.manage">
        <td className="py-2 pr-4">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRevoke}
            disabled={revokeSessions.isPending}
          >
            {revokeSessions.isPending ? 'Revoking…' : 'Revoke sessions'}
          </Button>
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

function InviteUserForm({
  roleOptions,
}: {
  roleOptions: { id: string; name: string }[];
}): JSX.Element {
  const inviteUser = useInviteUser();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteUserRequest>({ resolver: zodResolver(inviteUserRequestSchema) });

  const onSubmit = handleSubmit((values) => {
    inviteUser.mutate(values, { onSuccess: () => reset() });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a user</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={onSubmit}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              {...register('email')}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input
              id="invite-name"
              {...register('fullName')}
              aria-invalid={Boolean(errors.fullName)}
            />
            {errors.fullName && <p className="text-sm text-red-600">{errors.fullName.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" {...register('roleId')} aria-invalid={Boolean(errors.roleId)}>
              <option value="">Select a role…</option>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
            {errors.roleId && <p className="text-sm text-red-600">{errors.roleId.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-password">Temporary password</Label>
            <Input
              id="invite-password"
              type="text"
              {...register('tempPassword')}
              aria-invalid={Boolean(errors.tempPassword)}
            />
            {errors.tempPassword && (
              <p className="text-sm text-red-600">{errors.tempPassword.message}</p>
            )}
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            {inviteUser.error && (
              <p role="alert" className="mb-2 text-sm text-red-600">
                {describeError(inviteUser.error)}
              </p>
            )}
            <Button type="submit" disabled={inviteUser.isPending}>
              {inviteUser.isPending ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
