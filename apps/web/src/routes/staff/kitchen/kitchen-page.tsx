import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { KitchenOrderStatus, KitchenOrderTicketView } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { KitchenTicket } from '@/components/ui/kitchen-ticket';
import { useMe } from '@/features/auth/use-auth';
import { useKitchenOrders, useKitchenTransition } from '@/features/kitchen/use-kitchen-orders';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function getElapsed(
  placedAtIso: string,
  now: Date,
): { text: string; urgency: 'normal' | 'rush' | 'late' } {
  const placed = new Date(placedAtIso).getTime();
  const diffMs = Math.max(0, now.getTime() - placed);
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const text = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} min`;

  let urgency: 'normal' | 'rush' | 'late' = 'normal';
  if (minutes >= 20) {
    urgency = 'late';
  } else if (minutes >= 10) {
    urgency = 'rush';
  }

  return { text, urgency };
}

type ActiveTab = 'queue' | 'prep' | 'ready';

export function KitchenPage(): JSX.Element {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: ordersResponse, isLoading, isError, error, refetch } = useKitchenOrders();
  const transitionMutation = useKitchenTransition();

  const [now, setNow] = React.useState<Date>(new Date());
  const [activeTab, setActiveTab] = React.useState<ActiveTab>('queue');
  const [conflictNotice, setConflictNotice] = React.useState<string | null>(null);

  // Clock ticker for elapsed time counter
  React.useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for conflict error
  React.useEffect(() => {
    if (
      transitionMutation.error &&
      transitionMutation.error instanceof ApiError &&
      transitionMutation.error.code === 'VERSION_CONFLICT'
    ) {
      setConflictNotice('Docket conflict: another station updated this ticket. Queue refreshed.');
      const timer = setTimeout(() => setConflictNotice(null), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [transitionMutation.error]);

  const canAcceptNew = me?.permissions.includes('orders.transition.front') ?? false;

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-slate-400">
        <div className="w-10 h-10 rounded-full border-4 border-slate-700 border-t-primary animate-spin" />
        <span className="text-sm font-semibold tracking-wide">Loading kitchen queue…</span>
      </div>
    );
  }

  if (isError) {
    const isFeatureDisabled =
      (error instanceof ApiError && error.code === 'FEATURE_DISABLED') ||
      (error instanceof ApiError && error.status === 403);

    if (isFeatureDisabled) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
            <svg
              className="w-7 h-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="9" x2="15" y2="15" />
              <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Kitchen Display Disabled</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Kitchen Display is not enabled for this restaurant. Please ask an owner or manager to
              enable Kitchen Display in Tenant Settings.
            </p>
          </div>
          <Button
            type="button"
            variant="default"
            size="touch"
            onClick={() => navigate('/app/orders')}
            className="mt-2 font-semibold"
          >
            Back to Orders
          </Button>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="text-rose-400 font-semibold">
          {error instanceof Error ? error.message : 'Could not load kitchen orders.'}
        </span>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => refetch()}
          className="border-slate-700 text-slate-200 hover:bg-slate-800"
        >
          Try Again
        </Button>
      </div>
    );
  }

  const tickets = ordersResponse?.data ?? [];

  const queueOrders = tickets.filter((t) => t.status === 'NEW' || t.status === 'ACCEPTED');
  const prepOrders = tickets.filter((t) => t.status === 'PREPARING');
  const readyOrders = tickets.filter((t) => t.status === 'READY');

  const handleBump = (ticket: KitchenOrderTicketView) => {
    let nextStatus: KitchenOrderStatus | null = null;
    if (ticket.status === 'NEW' && canAcceptNew) {
      nextStatus = 'ACCEPTED';
    } else if (ticket.status === 'ACCEPTED') {
      nextStatus = 'PREPARING';
    } else if (ticket.status === 'PREPARING') {
      nextStatus = 'READY';
    }

    if (!nextStatus) return;

    transitionMutation.mutate({
      id: ticket.id,
      to: nextStatus,
      expectedVersion: ticket.version,
    });
  };

  const renderTicket = (ticket: KitchenOrderTicketView) => {
    const elapsed = getElapsed(ticket.placedAt, now);
    const isPendingThis =
      transitionMutation.isPending && transitionMutation.variables?.id === ticket.id;

    return (
      <KitchenTicket
        key={ticket.id}
        orderNumber={ticket.orderNumber}
        tableName={ticket.tableName}
        customerName={ticket.customerName}
        source={ticket.source}
        type={ticket.type}
        status={ticket.status}
        elapsedTime={elapsed.text}
        urgency={elapsed.urgency}
        notes={ticket.notes}
        isEdited={ticket.isEdited}
        editReason={ticket.editReason}
        checklist={false}
        items={ticket.lines.map((l) => ({
          id: l.id,
          name: l.itemName,
          quantity: l.qty,
          variantName: l.variantName,
          notes: l.notes,
          status: l.status,
          addons: l.addons,
        }))}
        canAcceptNew={canAcceptNew}
        onBumpTicket={
          ticket.status !== 'READY' && (ticket.status !== 'NEW' || canAcceptNew)
            ? () => handleBump(ticket)
            : undefined
        }
        bumpLoading={isPendingThis}
        className="shrink-0 bg-slate-900 border-slate-800 text-slate-100 shadow-md"
      />
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      {/* Concurrency conflict alert banner */}
      {conflictNotice && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-bold flex items-center justify-center gap-2 shrink-0 animate-in fade-in duration-200">
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{conflictNotice}</span>
        </div>
      )}

      {/* Mobile Tab Switcher (< 768px) */}
      <div className="md:hidden flex border-b border-slate-800 bg-slate-900/60 p-2 gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={cn(
            'flex-1 py-2.5 px-3 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 min-h-[44px]',
            activeTab === 'queue'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white',
          )}
        >
          <span>Queue</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-white text-[10px]">
            {queueOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('prep')}
          className={cn(
            'flex-1 py-2.5 px-3 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 min-h-[44px]',
            activeTab === 'prep'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white',
          )}
        >
          <span>In Prep</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-white text-[10px]">
            {prepOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ready')}
          className={cn(
            'flex-1 py-2.5 px-3 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 min-h-[44px]',
            activeTab === 'ready'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white',
          )}
        >
          <span>Ready</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-white text-[10px]">
            {readyOrders.length}
          </span>
        </button>
      </div>

      {/* Swimlanes Layout */}
      <div className="flex-1 p-3 sm:p-4 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full min-h-0">
          {/* Swimlane 1: Queue (NEW + ACCEPTED) */}
          <section
            className={cn(
              'flex flex-col bg-slate-900/40 rounded-xl border border-slate-800/80 overflow-hidden min-h-0',
              activeTab !== 'queue' && 'hidden md:flex',
            )}
          >
            <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                <h3 className="font-bold text-sm uppercase tracking-wider text-slate-200">
                  To Cook (Queue)
                </h3>
              </div>
              <span className="font-tabular text-xs font-black px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                {queueOrders.length}
              </span>
            </div>

            <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto min-h-[200px]">
              {queueOrders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs font-medium">
                  No tickets waiting in queue
                </div>
              ) : (
                queueOrders.map(renderTicket)
              )}
            </div>
          </section>

          {/* Swimlane 2: In Prep (PREPARING) */}
          <section
            className={cn(
              'flex flex-col bg-slate-900/40 rounded-xl border border-slate-800/80 overflow-hidden min-h-0',
              activeTab !== 'prep' && 'hidden md:flex',
            )}
          >
            <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <h3 className="font-bold text-sm uppercase tracking-wider text-slate-200">
                  In Preparation
                </h3>
              </div>
              <span className="font-tabular text-xs font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {prepOrders.length}
              </span>
            </div>

            <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto min-h-[200px]">
              {prepOrders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs font-medium">
                  No dishes currently cooking
                </div>
              ) : (
                prepOrders.map(renderTicket)
              )}
            </div>
          </section>

          {/* Swimlane 3: Ready at Pass (READY) */}
          <section
            className={cn(
              'flex flex-col bg-slate-900/40 rounded-xl border border-slate-800/80 overflow-hidden min-h-0',
              activeTab !== 'ready' && 'hidden md:flex',
            )}
          >
            <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="font-bold text-sm uppercase tracking-wider text-slate-200">
                  Ready at Pass
                </h3>
              </div>
              <span className="font-tabular text-xs font-black px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {readyOrders.length}
              </span>
            </div>

            <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto min-h-[200px]">
              {readyOrders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs font-medium">
                  The pass is clear
                </div>
              ) : (
                readyOrders.map(renderTicket)
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
