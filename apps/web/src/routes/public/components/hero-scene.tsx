import { OrderCard } from '@/components/ui/order-card';
import { KitchenTicket } from '@/components/ui/kitchen-ticket';
import { BillSummary } from '@/components/ui/bill-summary';
import { TableStatus } from '@/components/ui/table-status';
import { cn } from '@/lib/utils';
import {
  BILL_PREVIEW_1042,
  ORDER_1042,
  TICKET_1042,
  formatRupees,
  orderItemCount,
  orderTotal,
  table,
} from '../landing-demo-data';
import { ComingSoon } from './landing-primitives';

const table04 = table('04');

function Step({
  label,
  comingSoon = false,
  className,
  children,
}: {
  label: string;
  comingSoon?: boolean;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2 min-w-0', className)}>
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {comingSoon && <ComingSoon />}
      </div>
      {children}
    </div>
  );
}

/**
 * One scene: Table 04 → Order #1042 → its kitchen ticket → the bill it will
 * become. Purely illustrative. The Table and Order cards show what staff can
 * use today; Kitchen and Bill are marked as coming soon. Below `md` only the
 * first two steps render (the kitchen and billing sections follow immediately);
 * from `md` up they sit in a 2×2 grid, and four-across from `xl`.
 */
export function HeroScene(): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Illustration: Table 04 places order 1042, which becomes a kitchen ticket and then a bill"
      className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-x-5 gap-y-6 rounded-xl border border-border bg-surface-subtle p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-4"
    >
      <Step label="1 · Table">
        <TableStatus
          tableNumber="04"
          capacity={table04?.seats ?? 4}
          state="OCCUPIED"
          elapsedTime={`${table04?.sessionMinutes ?? 24} min seated`}
          orderNumber={ORDER_1042.orderNumber}
          currentBill={formatRupees(orderTotal(ORDER_1042))}
        />
      </Step>

      <Step label="2 · Order">
        <OrderCard
          orderNumber={ORDER_1042.orderNumber}
          tableLabel="Table 04"
          status={ORDER_1042.status}
          elapsedTime={ORDER_1042.age}
          itemCount={orderItemCount(ORDER_1042)}
          itemsSummary={ORDER_1042.lines.map((l) => ({
            name: l.name,
            quantity: l.quantity,
            ...(l.note ? { notes: l.note } : {}),
          }))}
          totalAmount={formatRupees(orderTotal(ORDER_1042))}
          className="hover:shadow-sm"
        />
      </Step>

      <Step label="3 · Kitchen" comingSoon className="hidden md:flex">
        <KitchenTicket
          ticketNumber={TICKET_1042.ticketNumber}
          tableNumber={TICKET_1042.tableNumber}
          elapsedTime={TICKET_1042.elapsed}
          items={TICKET_1042.items}
          checklist={false}
        />
      </Step>

      <Step label="4 · Bill" comingSoon className="hidden md:flex">
        <BillSummary
          titleAs="p"
          tableLabel={BILL_PREVIEW_1042.tableLabel}
          items={BILL_PREVIEW_1042.items}
          subtotal={BILL_PREVIEW_1042.subtotal}
          grandTotal={BILL_PREVIEW_1042.grandTotal}
        />
      </Step>
    </div>
  );
}
