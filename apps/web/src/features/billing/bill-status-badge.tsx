import type { BillStatus } from '@rewardbite/contracts';
import { Badge } from '@/components/ui/badge';

const LABELS: Record<
  BillStatus,
  { label: string; variant: Parameters<typeof Badge>[0]['variant'] }
> = {
  DRAFT: { label: 'Draft', variant: 'muted' },
  FINALIZED: { label: 'Awaiting payment', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  VOID: { label: 'Void', variant: 'destructive' },
  DISCARDED: { label: 'Discarded', variant: 'muted' },
};

/** Text label + colour (never colour alone). */
export function BillStatusBadge({ status }: { status: BillStatus }): JSX.Element {
  const { label, variant } = LABELS[status];
  return <Badge variant={variant}>{label}</Badge>;
}
