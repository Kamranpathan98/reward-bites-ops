import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { loginRequestSchema, type LoginRequest } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { useLogin } from '@/features/auth/use-auth';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });

  const onSubmit = handleSubmit((values) => {
    loginMutation.mutate(values, {
      onSuccess: (data) => {
        if (data.memberships.length === 1) {
          navigate('/app', { replace: true });
        } else {
          navigate('/app/select-tenant', {
            replace: true,
            state: { memberships: data.memberships },
          });
        }
      },
    });
  });

  const errorMessage = describeLoginError(loginMutation.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to RewardBite</CardTitle>
          <CardDescription>Staff and owner login.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="password-error" className="text-sm text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            {errorMessage && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage}
              </p>
            )}

            <Button type="submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              New to RewardBite?{' '}
              <Link to="/signup" className="font-medium text-primary-strong underline">
                Create a restaurant account
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function describeLoginError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 423) return 'Too many failed attempts. Try again in a few minutes.';
    if (error.status === 401) return 'Incorrect email or password.';
    if (error.status === 0)
      return 'Could not reach the server. Check your connection and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
