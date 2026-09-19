import { cn } from '@/lib/utils';
import { ComingSoon } from './landing-primitives';

interface WorkflowStep {
  title: string;
  description: string;
  comingSoon?: boolean;
}

const STEPS: WorkflowStep[] = [
  {
    title: 'Table',
    description: 'Each table has its own QR code and an open session while guests are seated.',
  },
  {
    title: 'Order',
    description:
      'Staff take the order against the table. Every order moves through clear statuses.',
  },
  {
    title: 'Kitchen',
    description: 'The kitchen sees each order as a ticket and marks it ready.',
    comingSoon: true,
  },
  {
    title: 'Bill',
    description:
      'One itemised bill per table. Payment status is tracked separately from the order.',
    comingSoon: true,
  },
];

/** Text-only four-step overview. The visual story lives in the hero and the sections below. */
export function SyncWorkflow({ className }: { className?: string }): JSX.Element {
  return (
    <ol className={cn('grid gap-6 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-2 border-t-2 border-border pt-4">
          <div className="flex items-center gap-2">
            <span className="font-tabular text-sm font-bold text-primary-strong">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
            {step.comingSoon && <ComingSoon />}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
        </li>
      ))}
    </ol>
  );
}
