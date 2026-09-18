import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';

/**
 * Onboarding entry point (docs/IMPLEMENTATION_STATUS.md "Onboarding"
 * section). Not a marketing site rebuild — just the two doors a visitor
 * needs: start a new restaurant, or sign in to an existing one.
 */
export function LandingPage(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-secondary p-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">RewardBite</h1>
        <p className="text-lg text-muted-foreground">Restaurant ordering &amp; operations</p>
      </div>

      <Link to="/signup" className={buttonVariants({ size: 'lg' })}>
        Get Started
      </Link>

      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/app/login" className="font-medium text-primary underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
