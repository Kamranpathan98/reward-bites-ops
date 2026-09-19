import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StatusBadge, type OperationalStatus } from '@/components/ui/status-badge';
import { MetricCard } from '@/components/ui/metric-card';
import { OrderCard } from '@/components/ui/order-card';
import { KitchenTicket } from '@/components/ui/kitchen-ticket';
import { TableStatus } from '@/components/ui/table-status';
import { BillSummary } from '@/components/ui/bill-summary';
import { TabsList, TabTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/data-table';

export function DesignSystemShowcase(): JSX.Element {
  const [activeTab, setActiveTab] = React.useState('ALL');
  const [kitchenChecked, setKitchenChecked] = React.useState<Record<string, boolean>>({
    item1: false,
    item2: true,
  });

  const toggleKitchenItem = (id: string) => {
    setKitchenChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const operationalStatuses: OperationalStatus[] = [
    'NEW',
    'ACCEPTED',
    'PREPARING',
    'READY',
    'COMPLETED',
    'PAID',
    'PENDING',
    'CANCELLED',
    'VOID',
  ];

  return (
    <div className="w-full flex flex-col gap-8 pb-16 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              RewardBite Design System Showcase
            </h1>
            <span className="rounded bg-primary/10 text-primary-strong px-2 py-0.5 text-xs font-bold font-tabular">
              v1.0 Canonical
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Visual reference for Warm Operational SaaS: semantic tokens, typography, primitives, and
            domain components.
          </p>
        </div>
        <div className="shrink-0">
          <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-sm">
            DEMO DATA — VISUAL SHOWCASE ONLY
          </span>
        </div>
      </div>

      {/* 1. Core Color Palette */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">1. Core Color Palette</h2>
          <p className="text-xs text-muted-foreground">
            Warm Terracotta primary accent with Deep Slate neutrals and multi-tiered surface
            elevations.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* Primary */}
          <div className="flex flex-col rounded border border-border bg-surface p-3 shadow-sm">
            <div className="h-12 w-full rounded bg-primary mb-2 shadow-inner" />
            <span className="text-xs font-bold text-foreground">Primary Accent</span>
            <span className="text-caption font-tabular text-muted-foreground">#EA580C</span>
            <span className="text-caption text-primary-strong font-semibold mt-1">
              var(--primary)
            </span>
          </div>
          {/* Primary Hover */}
          <div className="flex flex-col rounded border border-border bg-surface p-3 shadow-sm">
            <div className="h-12 w-full rounded bg-primary-hover mb-2 shadow-inner" />
            <span className="text-xs font-bold text-foreground">Primary Hover</span>
            <span className="text-caption font-tabular text-muted-foreground">#C2410C</span>
            <span className="text-caption text-muted-foreground mt-1">var(--primary-hover)</span>
          </div>
          {/* Primary Active */}
          <div className="flex flex-col rounded border border-border bg-surface p-3 shadow-sm">
            <div className="h-12 w-full rounded bg-primary-active mb-2 shadow-inner" />
            <span className="text-xs font-bold text-foreground">Primary Active</span>
            <span className="text-caption font-tabular text-muted-foreground">#9A3412</span>
            <span className="text-caption text-muted-foreground mt-1">var(--primary-active)</span>
          </div>
          {/* Secondary / Deep Slate */}
          <div className="flex flex-col rounded border border-border bg-surface p-3 shadow-sm">
            <div className="h-12 w-full rounded bg-secondary mb-2 shadow-inner" />
            <span className="text-xs font-bold text-foreground">Secondary Slate</span>
            <span className="text-caption font-tabular text-muted-foreground">#0F172A</span>
            <span className="text-caption text-muted-foreground mt-1">var(--secondary)</span>
          </div>
          {/* Canvas Base */}
          <div className="flex flex-col rounded border border-border bg-surface p-3 shadow-sm">
            <div className="h-12 w-full rounded bg-background border border-border mb-2" />
            <span className="text-xs font-bold text-foreground">Canvas Base</span>
            <span className="text-caption font-tabular text-muted-foreground">#F8FAFC</span>
            <span className="text-caption text-muted-foreground mt-1">var(--background)</span>
          </div>
          {/* Surface */}
          <div className="flex flex-col rounded border border-border bg-surface p-3 shadow-sm">
            <div className="h-12 w-full rounded bg-surface border border-border mb-2" />
            <span className="text-xs font-bold text-foreground">Surface Card</span>
            <span className="text-caption font-tabular text-muted-foreground">#FFFFFF</span>
            <span className="text-caption text-muted-foreground mt-1">var(--surface)</span>
          </div>
        </div>
      </section>

      {/* 2. Operational Status System (All 9 Canonical States) */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            2. Canonical Operational Status System
          </h2>
          <p className="text-xs text-muted-foreground">
            Strict non-color reliance: every operational state pairs color with an explicit text
            label and icon glyph.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {operationalStatuses.map((status) => (
            <div
              key={status}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface shadow-sm"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-foreground">{status}</span>
                <span className="text-caption text-muted-foreground truncate">
                  Role: {status.toLowerCase()}
                </span>
              </div>
              <StatusBadge status={status} size="default" />
            </div>
          ))}
        </div>
      </section>

      {/* 3. Typography & Tabular Numerics */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">3. Typography & Tabular Figures</h2>
          <p className="text-xs text-muted-foreground">
            Inter typeface with strict <code>font-tabular</code> / <code>tabular-nums</code> for
            vertical column alignment.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tabular Numerics Alignment Verification</CardTitle>
            <CardDescription>
              Tabular numerals ensure digit widths remain uniform across all numbers so financial
              and operational data never jitters.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border border-border rounded-lg p-4 bg-surface-muted/30">
              <div className="flex flex-col gap-1 font-tabular">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Currency Column
                </span>
                <span className="text-base font-bold text-foreground">₹148,250.00</span>
                <span className="text-base font-bold text-foreground">₹001,450.00</span>
                <span className="text-base font-bold text-foreground">₹000,089.50</span>
              </div>
              <div className="flex flex-col gap-1 font-tabular">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Order Timers
                </span>
                <span className="text-base font-medium text-foreground">18:40 min</span>
                <span className="text-base font-medium text-foreground">04:12 min</span>
                <span className="text-base font-medium text-foreground">00:45 min</span>
              </div>
              <div className="flex flex-col gap-1 font-tabular">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Table Session Pax
                </span>
                <span className="text-base font-medium text-foreground">T-01 • 04 Pax</span>
                <span className="text-base font-medium text-foreground">T-02 • 12 Pax</span>
                <span className="text-base font-medium text-foreground">T-08 • 02 Pax</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 4. Core UI Primitives */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">4. Form & Interactive Primitives</h2>
          <p className="text-xs text-muted-foreground">
            Buttons, text inputs, selects, and tab bars with keyboard focus indicators.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Button Variants */}
          <Card>
            <CardHeader>
              <CardTitle>Button Variants & Sizes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="default">Primary CTA</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border-subtle">
                <Button size="sm">Small (32px)</Button>
                <Button size="default">Default (36px)</Button>
                <Button size="lg">Large (40px)</Button>
                <Button size="touch">Touch POS (44px)</Button>
              </div>
            </CardContent>
          </Card>

          {/* Form Inputs & Tabs */}
          <Card>
            <CardHeader>
              <CardTitle>Form Controls & Tab Navigation</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">
                    Default Input (36px)
                  </label>
                  <Input placeholder="Enter table or item..." />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">
                    Touch POS Input (44px)
                  </label>
                  <Input sizeVariant="touch" placeholder="Search order #1042..." />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">Role Selector</label>
                  <Select defaultValue="manager">
                    <option value="owner">Owner</option>
                    <option value="manager">Store Manager</option>
                    <option value="cashier">Cashier</option>
                    <option value="kitchen">Kitchen Staff</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">Invalid Field</label>
                  <Input aria-invalid="true" defaultValue="invalid_tax_rate" />
                </div>
              </div>

              <div className="pt-2 border-t border-border-subtle flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">Pipeline Tabs Ribbon</label>
                <TabsList>
                  <TabTrigger
                    active={activeTab === 'ALL'}
                    count={34}
                    onClick={() => setActiveTab('ALL')}
                  >
                    ALL
                  </TabTrigger>
                  <TabTrigger
                    active={activeTab === 'NEW'}
                    count={4}
                    onClick={() => setActiveTab('NEW')}
                  >
                    NEW
                  </TabTrigger>
                  <TabTrigger
                    active={activeTab === 'PREPARING'}
                    count={6}
                    onClick={() => setActiveTab('PREPARING')}
                  >
                    PREPARING
                  </TabTrigger>
                  <TabTrigger
                    active={activeTab === 'READY'}
                    count={4}
                    onClick={() => setActiveTab('READY')}
                  >
                    READY
                  </TabTrigger>
                </TabsList>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 5. Domain Components: Metric Cards */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">5. Operational Metric Cards</h2>
          <p className="text-xs text-muted-foreground">
            Bird's-eye metrics with tabular totals, sparkline progress bars, and percentage
            indicators.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Today's Revenue"
            value="₹48,250"
            subtitle="62 paid bills"
            trend={{ value: '+14.2%', isPositive: true, label: 'vs yesterday' }}
            progressPercent={78}
            progressColor="bg-primary"
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
          />
          <MetricCard
            title="Live Orders"
            value="18"
            subtitle="6 in kitchen"
            trend={{ value: '4 new', isPositive: true }}
            progressPercent={65}
            progressColor="bg-amber-500"
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M7 15h0M2 9.5h20" />
              </svg>
            }
          />
          <MetricCard
            title="Table Occupancy"
            value="14 / 18"
            subtitle="78% load"
            trend={{ value: '42m', isPositive: true, label: 'avg turn' }}
            progressPercent={78}
            progressColor="bg-emerald-500"
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            }
          />
          <MetricCard
            title="Kitchen Queue"
            value="7 Tickets"
            subtitle="14.5m avg"
            trend={{ value: '1 late', isPositive: false }}
            progressPercent={40}
            progressColor="bg-rose-500"
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
          />
        </div>
      </section>

      {/* 6. Domain Components: Tables & Orders */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">6. Floor Nodes & Order Cards</h2>
          <p className="text-xs text-muted-foreground">
            Table status representations and operational order cards.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Table: Available */}
          <TableStatus
            tableNumber="T-01"
            capacity="4 Pax"
            state="AVAILABLE"
            onAction={() => {}}
            actionLabel="Open Table"
          />
          {/* Table: Occupied */}
          <TableStatus
            tableNumber="T-02"
            capacity="2 Pax"
            state="OCCUPIED"
            elapsedTime="34m"
            guestCount={2}
            currentBill="₹1,450"
            orderNumber="#1042"
            onAction={() => {}}
            actionLabel="View Order"
          />
          {/* Table: Bill Requested */}
          <TableStatus
            tableNumber="T-03"
            capacity="6 Pax"
            state="BILL_REQUESTED"
            elapsedTime="52m"
            guestCount={5}
            currentBill="₹3,890"
            orderNumber="#1039"
            onAction={() => {}}
            actionLabel="Settle ₹3,890"
          />
        </div>

        {/* Order Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <OrderCard
            orderNumber="#1042"
            tableLabel="Table 04"
            source="Dine-in"
            status="PREPARING"
            elapsedTime="14m"
            itemCount={3}
            totalAmount="₹1,240"
            itemsSummary={[
              { name: 'Butter Chicken', quantity: 2, notes: 'Medium spice, nut-free' },
              { name: 'Garlic Naan', quantity: 3 },
              { name: 'Mango Lassi', quantity: 2 },
            ]}
            actions={
              <Button size="sm" variant="default">
                Mark Ready
              </Button>
            }
          />
          <OrderCard
            orderNumber="#1043"
            tableLabel="Takeaway #08"
            source="Takeaway"
            status="READY"
            elapsedTime="06m"
            itemCount={2}
            totalAmount="₹680"
            itemsSummary={[
              { name: 'Paneer Tikka Roll', quantity: 2 },
              { name: 'Masala Chai', quantity: 2 },
            ]}
            actions={
              <Button size="sm" variant="outline">
                Deliver to Customer
              </Button>
            }
          />
        </div>
      </section>

      {/* 7. Domain Components: Kitchen Ticket & Bill Summary */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            7. Kitchen KDS Docket & Bill Settlement
          </h2>
          <p className="text-xs text-muted-foreground">
            Touch-first KDS docket with strike-through cooking items, allergy warnings, and invoice
            summaries.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Kitchen Ticket */}
          <KitchenTicket
            ticketNumber="TICKET #1042"
            tableNumber="TABLE 04"
            elapsedTime="18:40 min - LATE"
            urgency="late"
            guestCount={4}
            captain="Amit D."
            allergenAlert="CUSTOMER ALLERGY: NO NUTS / PEANUTS"
            items={[
              {
                id: 'item1',
                name: 'Butter Chicken',
                quantity: 2,
                courseCategory: 'Curry',
                notes: 'Spicy: Medium, Extra Gravy, NUT-FREE',
                completed: Boolean(kitchenChecked['item1']),
              },
              {
                id: 'item2',
                name: 'Tandoori Roti',
                quantity: 4,
                courseCategory: 'Breads',
                completed: Boolean(kitchenChecked['item2']),
              },
            ]}
            onToggleItem={toggleKitchenItem}
            onBumpTicket={() => {}}
            bumpLabel="Bump Ticket (Complete)"
          />

          {/* Bill Summary */}
          <BillSummary
            invoiceNumber="INV-892"
            tableLabel="Table 04 • Dine-in (4 Guests)"
            items={[
              {
                name: 'Butter Chicken (Half)',
                quantity: 2,
                unitPrice: '₹480.00',
                totalPrice: '₹960.00',
              },
              { name: 'Garlic Naan', quantity: 4, unitPrice: '₹70.00', totalPrice: '₹280.00' },
            ]}
            subtotal="₹1,240.00"
            discounts={[{ name: 'Happy Hour 10%', amount: '₹124.00' }]}
            taxes={[
              { name: 'CGST', percent: 2.5, amount: '₹27.90' },
              { name: 'SGST', percent: 2.5, amount: '₹27.90' },
            ]}
            serviceCharge="₹50.00"
            grandTotal="₹1,221.80"
            paymentStatus="PENDING"
            paymentMethod="UPI / QR Code"
            onSettle={() => {}}
            settleLabel="Settle ₹1,221.80"
          />
        </div>
      </section>

      {/* 8. Data Table Component */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            8. High-Density Operational Data Table
          </h2>
          <p className="text-xs text-muted-foreground">
            Sticky table headers, right-aligned tabular numbers, and zero-overflow scroll
            containment.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Table / Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Elapsed</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-bold font-tabular">#1042</TableCell>
              <TableCell>Table 04 (Main Hall)</TableCell>
              <TableCell>
                <StatusBadge status="PREPARING" size="sm" />
              </TableCell>
              <TableCell className="text-right font-tabular">3 items</TableCell>
              <TableCell className="text-right font-tabular text-amber-800">14m 12s</TableCell>
              <TableCell className="text-right font-bold font-tabular">₹1,240.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-bold font-tabular">#1043</TableCell>
              <TableCell>Takeaway #08</TableCell>
              <TableCell>
                <StatusBadge status="READY" size="sm" />
              </TableCell>
              <TableCell className="text-right font-tabular">2 items</TableCell>
              <TableCell className="text-right font-tabular text-emerald-700">06m 45s</TableCell>
              <TableCell className="text-right font-bold font-tabular">₹680.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-bold font-tabular">#1044</TableCell>
              <TableCell>Table 02 (Balcony)</TableCell>
              <TableCell>
                <StatusBadge status="NEW" size="sm" />
              </TableCell>
              <TableCell className="text-right font-tabular">4 items</TableCell>
              <TableCell className="text-right font-tabular text-sky-700">01m 15s</TableCell>
              <TableCell className="text-right font-bold font-tabular">₹2,150.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-bold font-tabular">#1040</TableCell>
              <TableCell>Table 07 (Patio)</TableCell>
              <TableCell>
                <StatusBadge status="PAID" size="sm" />
              </TableCell>
              <TableCell className="text-right font-tabular">5 items</TableCell>
              <TableCell className="text-right font-tabular text-muted-foreground">
                42m 00s
              </TableCell>
              <TableCell className="text-right font-bold font-tabular">₹3,450.00</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* 9. Feedback States: Skeleton & Empty State */}
      <section className="flex flex-col gap-3 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">9. Feedback States</h2>
          <p className="text-xs text-muted-foreground">
            Graceful loading skeleton placeholders and operational empty states.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Skeleton Loading State</CardTitle>
              <CardDescription>
                Reserves layout bounds to eliminate Cumulative Layout Shift (CLS).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-10 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-32" />
              </div>
            </CardContent>
          </Card>

          <EmptyState
            title="No Pending Orders"
            description="All orders have been accepted and dispatched to the kitchen queue."
            action={
              <Button variant="outline" size="sm">
                Refresh Pipeline
              </Button>
            }
          />
        </div>
      </section>
    </div>
  );
}
