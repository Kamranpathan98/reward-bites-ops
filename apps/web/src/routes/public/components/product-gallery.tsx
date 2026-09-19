import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { KitchenTicket } from '@/components/ui/kitchen-ticket';
import { MetricCard } from '@/components/ui/metric-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableStatus } from '@/components/ui/table-status';
import { TabTrigger, TabsList } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/data-table';
import {
  DASHBOARD,
  EXPENSE_CAVEAT,
  GALLERY_MENU_ITEMS,
  GALLERY_TICKETS,
  ORDERS,
  ORDER_1042,
  TABLES,
  formatRupees,
  orderSummaryText,
  orderTotal,
} from '../landing-demo-data';
import { ComingSoon } from './landing-primitives';

type GalleryTab = 'dashboard' | 'orders' | 'tables' | 'kitchen' | 'menu';

interface TabDefinition {
  id: GalleryTab;
  label: string;
  caption: string;
  comingSoon?: boolean;
}

const ORDERS_TAB: TabDefinition = {
  id: 'orders',
  label: 'Orders',
  caption: 'Every order and its status',
};

const TABS: TabDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    caption: 'Today at a glance',
    comingSoon: true,
  },
  ORDERS_TAB,
  { id: 'tables', label: 'Tables', caption: 'Which tables are seated' },
  { id: 'kitchen', label: 'Kitchen', caption: 'Tickets for the kitchen', comingSoon: true },
  { id: 'menu', label: 'Menu', caption: 'What is on the menu, and what is out' },
];

const rupees = (amount: number): string => `₹${amount.toLocaleString('en-IN')}`;

function DashboardPanel(): JSX.Element {
  const cashShare = Math.round((DASHBOARD.cash / DASHBOARD.collected) * 100);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard title="Orders" value={DASHBOARD.orders} className="p-4" />
        <MetricCard title="Revenue" value={rupees(DASHBOARD.revenue)} className="p-4" />
        <MetricCard title="Collected" value={rupees(DASHBOARD.collected)} className="p-4" />
        <MetricCard title="Outstanding" value={rupees(DASHBOARD.outstanding)} className="p-4" />
        <MetricCard title="Expenses" value={rupees(DASHBOARD.expenses)} className="p-4" />
        <MetricCard
          title="Average order"
          value={rupees(DASHBOARD.averageOrderValue)}
          className="p-4"
        />
        <MetricCard
          title="Operating result"
          value={rupees(DASHBOARD.operatingResult)}
          subtitle="Revenue − recorded expenses"
          className="col-span-2 p-4 lg:col-span-1"
        />
        <MetricCard
          title="Cash vs UPI"
          value={`${cashShare}% / ${100 - cashShare}%`}
          subtitle={`${rupees(DASHBOARD.cash)} cash · ${rupees(DASHBOARD.upi)} UPI`}
          className="col-span-2 p-4 lg:col-span-1"
        />
      </div>
      <p className="text-xs text-muted-foreground">{EXPENSE_CAVEAT}</p>
    </div>
  );
}

function OrdersPanel(): JSX.Element {
  return (
    <>
      {/* Small screens: a compact list reads better than a five-column table. */}
      <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-surface md:hidden">
        {ORDERS.map((order) => (
          <li key={order.orderNumber} className="flex flex-col gap-1.5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold font-tabular text-foreground">
                {order.orderNumber}
                <span className="ml-2 font-normal text-muted-foreground">
                  Table {order.tableNumber}
                </span>
              </p>
              <StatusBadge status={order.status} size="sm" />
            </div>
            <p className="text-sm text-muted-foreground">{orderSummaryText(order)}</p>
            <p className="flex justify-between text-xs text-muted-foreground">
              <span>{order.age}</span>
              <span className="font-tabular font-semibold text-foreground">
                {formatRupees(orderTotal(order))}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ORDERS.map((order) => (
              <TableRow key={order.orderNumber}>
                <TableCell className="font-semibold font-tabular">{order.orderNumber}</TableCell>
                <TableCell className="font-tabular">{order.tableNumber}</TableCell>
                <TableCell>
                  <StatusBadge status={order.status} size="sm" />
                </TableCell>
                <TableCell className="text-muted-foreground">{orderSummaryText(order)}</TableCell>
                <TableCell className="text-right font-tabular font-semibold">
                  {formatRupees(orderTotal(order))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function TablesPanel(): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {TABLES.map((t) => (
        <TableStatus
          key={t.number}
          tableNumber={t.number}
          capacity={t.seats}
          state={t.occupied ? 'OCCUPIED' : 'AVAILABLE'}
          {...(t.sessionMinutes ? { elapsedTime: `${t.sessionMinutes} min seated` } : {})}
          {...(t.number === '04'
            ? {
                orderNumber: ORDER_1042.orderNumber,
                currentBill: formatRupees(orderTotal(ORDER_1042)),
              }
            : {})}
          className="hover:shadow-sm"
        />
      ))}
    </div>
  );
}

function KitchenPanel(): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:max-w-3xl">
      {GALLERY_TICKETS.map((ticket) => (
        <KitchenTicket
          key={ticket.ticketNumber}
          ticketNumber={ticket.ticketNumber}
          tableNumber={ticket.tableNumber}
          elapsedTime={ticket.elapsed}
          items={ticket.items}
          checklist={false}
        />
      ))}
    </div>
  );
}

function MenuPanel(): JSX.Element {
  return (
    <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-surface">
      {GALLERY_MENU_ITEMS.map((item) => (
        <li key={item.name} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{item.name}</p>
            <p className="text-xs text-muted-foreground">{item.category}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-tabular font-semibold text-foreground">
              {formatRupees(item.price)}
            </span>
            <Badge variant={item.available ? 'success' : 'muted'}>
              {item.available ? 'Available' : 'Out today'}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

const PANELS: Record<GalleryTab, () => JSX.Element> = {
  dashboard: DashboardPanel,
  orders: OrdersPanel,
  tables: TablesPanel,
  kitchen: KitchenPanel,
  menu: MenuPanel,
};

/**
 * Tabbed illustration of the staff screens. Sample data only; screens that are
 * not shipped yet say so in the panel header. Keyboard: Tab enters the tablist
 * on the selected tab, then Arrow keys / Home / End move between tabs (see
 * `TabsList`). The tablist wraps instead of scrolling so every tab is visible
 * at any width.
 */
export function ProductGallery(): JSX.Element {
  const [active, setActive] = React.useState<GalleryTab>('orders');
  const current = TABS.find((tab) => tab.id === active) ?? ORDERS_TAB;
  const Panel = PANELS[current.id];

  return (
    <div className="flex flex-col gap-4">
      <TabsList
        aria-label="Product screens"
        className="flex flex-wrap w-full overflow-visible sm:w-auto sm:inline-flex self-start"
      >
        {TABS.map((tab) => (
          <TabTrigger
            key={tab.id}
            id={`gallery-tab-${tab.id}`}
            aria-controls={`gallery-panel-${tab.id}`}
            active={tab.id === active}
            onClick={() => setActive(tab.id)}
            className="min-h-11 px-4 text-sm"
          >
            {tab.label}
          </TabTrigger>
        ))}
      </TabsList>

      <div
        role="tabpanel"
        id={`gallery-panel-${current.id}`}
        aria-labelledby={`gallery-tab-${current.id}`}
        tabIndex={0}
        className="rounded-xl border border-border bg-surface-subtle p-4 sm:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-foreground">{current.caption}</p>
          {current.comingSoon && <ComingSoon />}
          <p className="text-xs text-muted-foreground sm:ml-auto">Illustration with sample data</p>
        </div>
        <Panel />
      </div>
    </div>
  );
}
