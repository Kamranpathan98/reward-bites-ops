import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { signupRequestSchema, type SignupRequest } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { useSignup } from '@/features/auth/use-auth';

export function SignupPage(): JSX.Element {
  const navigate = useNavigate();
  const signup = useSignup();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupRequest>({ resolver: zodResolver(signupRequestSchema) });

  const onSubmit = handleSubmit((values) => {
    signup.mutate(values, {
      onSuccess: () => navigate('/app/setup', { replace: true }),
    });
  });

  const errorMessage = describeSignupError(signup.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your RewardBite account</CardTitle>
          <CardDescription>
            Set up your restaurant in a couple of minutes — no credit card, no waiting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenantName">Restaurant name</Label>
              <Input
                id="tenantName"
                autoComplete="organization"
                aria-invalid={Boolean(errors.tenantName)}
                aria-describedby={errors.tenantName ? 'tenantName-error' : undefined}
                {...register('tenantName')}
              />
              {errors.tenantName && (
                <p id="tenantName-error" className="text-sm text-red-600">
                  {errors.tenantName.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ownerName">Your name</Label>
              <Input
                id="ownerName"
                autoComplete="name"
                aria-invalid={Boolean(errors.ownerName)}
                aria-describedby={errors.ownerName ? 'ownerName-error' : undefined}
                {...register('ownerName')}
              />
              {errors.ownerName && (
                <p id="ownerName-error" className="text-sm text-red-600">
                  {errors.ownerName.message}
                </p>
              )}
            </div>

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
                autoComplete="new-password"
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="passwordConfirmation">Confirm password</Label>
              <Input
                id="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.passwordConfirmation)}
                aria-describedby={
                  errors.passwordConfirmation ? 'passwordConfirmation-error' : undefined
                }
                {...register('passwordConfirmation')}
              />
              {errors.passwordConfirmation && (
                <p id="passwordConfirmation-error" className="text-sm text-red-600">
                  {errors.passwordConfirmation.message}
                </p>
              )}
            </div>

            {errorMessage && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage}
              </p>
            )}

            <Button type="submit" disabled={signup.isPending}>
              {signup.isPending ? 'Creating your account…' : 'Create account'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have a RewardBite account?{' '}
              <Link to="/app/login" className="font-medium text-primary-strong underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function describeSignupError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 409)
      return 'An account with this email already exists. Try signing in instead.';
    if (error.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
    if (error.status === 0)
      return 'Could not reach the server. Check your connection and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
