import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBadge, STATUS_CONFIG, type OperationalStatus } from '@/components/ui/status-badge';
import { MetricCard } from '@/components/ui/metric-card';
import { OrderCard } from '@/components/ui/order-card';
import { KitchenTicket } from '@/components/ui/kitchen-ticket';
import { TableStatus } from '@/components/ui/table-status';
import { BillSummary } from '@/components/ui/bill-summary';
import { TabsList, TabTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DesignSystemShowcase } from './design-system-showcase';

describe('RewardBite Design System Primitives & Tokens', () => {
  describe('StatusBadge (All 9 Canonical Operational Statuses)', () => {
    const statuses: OperationalStatus[] = [
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

    it.each(statuses)('renders status "%s" with proper accessible label and icon', (status) => {
      render(<StatusBadge status={status} />);
      const badge = screen.getByRole('status', {
        name: new RegExp(`Status: ${STATUS_CONFIG[status].label}`, 'i'),
      });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(STATUS_CONFIG[status].label);
    });

    it('renders with dot indicator when showDot is true', () => {
      const { container } = render(<StatusBadge status="READY" showDot />);
      const dot = container.querySelector('.rounded-full');
      expect(dot).toBeInTheDocument();
    });
  });

  describe('MetricCard', () => {
    it('renders title, tabular value, subtitle, and trend', () => {
      render(
        <MetricCard
          title="Today's Revenue"
          value="₹48,250"
          subtitle="62 paid bills"
          trend={{ value: '+14.2%', isPositive: true, label: 'vs yesterday' }}
          progressPercent={75}
        />,
      );

      expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
      expect(screen.getByText('₹48,250')).toBeInTheDocument();
      expect(screen.getByText('62 paid bills')).toBeInTheDocument();
      expect(screen.getByText('+14.2%')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    });
  });

  describe('OrderCard', () => {
    it('renders order metadata, item summary, and total amount', () => {
      render(
        <OrderCard
          orderNumber="#1042"
          tableLabel="Table 04"
          source="Dine-in"
          status="PREPARING"
          elapsedTime="14m"
          itemCount={2}
          totalAmount="₹1,240"
          itemsSummary={[
            { name: 'Butter Chicken', quantity: 2, notes: 'Nut-free' },
            { name: 'Garlic Naan', quantity: 3 },
          ]}
        />,
      );

      expect(screen.getByText('#1042')).toBeInTheDocument();
      expect(screen.getByText('Table 04')).toBeInTheDocument();
      expect(screen.getByText('Dine-in')).toBeInTheDocument();
      expect(screen.getByText('14m')).toBeInTheDocument();
      expect(screen.getByText(/Butter Chicken/)).toBeInTheDocument();
      expect(screen.getByText('₹1,240')).toBeInTheDocument();
    });
  });

  describe('KitchenTicket', () => {
    it('renders ticket docket, allergy warnings, and allows item strike-through', () => {
      render(
        <KitchenTicket
          ticketNumber="TICKET #1042"
          tableNumber="TABLE 04"
          elapsedTime="18:40 min"
          urgency="late"
          allergenAlert="CUSTOMER ALLERGY: NO NUTS"
          items={[
            { id: '1', name: 'Butter Chicken', quantity: 2, completed: false },
            { id: '2', name: 'Naan', quantity: 4, completed: true },
          ]}
        />,
      );

      expect(screen.getByText('TICKET #1042')).toBeInTheDocument();
      expect(screen.getByText('TABLE 04')).toBeInTheDocument();
      expect(screen.getByText('18:40 min')).toBeInTheDocument();
      expect(screen.getByText(/CUSTOMER ALLERGY: NO NUTS/)).toBeInTheDocument();
      expect(screen.getByText(/Butter Chicken/)).toBeInTheDocument();
    });

    it('renders read-only rows (no checkboxes) when checklist is false', () => {
      render(
        <KitchenTicket
          ticketNumber="TICKET #1042"
          tableNumber="TABLE 04"
          elapsedTime="06:20 min"
          checklist={false}
          items={[{ id: '1', name: 'Butter Chicken', quantity: 2, notes: 'Medium spice' }]}
        />,
      );

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.getByText(/Butter Chicken/)).toBeInTheDocument();
      expect(screen.getByText('Medium spice')).toBeInTheDocument();
    });

    it('keeps the interactive checklist by default', () => {
      render(
        <KitchenTicket
          ticketNumber="TICKET #1"
          tableNumber="TABLE 01"
          elapsedTime="01:00 min"
          items={[{ id: '1', name: 'Dal', quantity: 1 }]}
        />,
      );
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });
  });

  describe('TableStatus', () => {
    it('renders table number, capacity, and status', () => {
      render(
        <TableStatus
          tableNumber="T-01"
          capacity="4 Pax"
          state="OCCUPIED"
          elapsedTime="34m"
          currentBill="₹1,450"
        />,
      );

      expect(screen.getByText('T-01')).toBeInTheDocument();
      expect(screen.getByText('4 Pax')).toBeInTheDocument();
      expect(screen.getByText('Occupied')).toBeInTheDocument();
      expect(screen.getByText('34m')).toBeInTheDocument();
      expect(screen.getByText('₹1,450')).toBeInTheDocument();
    });
  });

  describe('BillSummary', () => {
    it('renders line items, tax breakdown, and grand total', () => {
      render(
        <BillSummary
          invoiceNumber="INV-892"
          tableLabel="Table 04"
          items={[{ name: 'Butter Chicken', quantity: 2, unitPrice: '₹500', totalPrice: '₹1,000' }]}
          subtotal="₹1,000.00"
          taxes={[{ name: 'CGST', percent: 2.5, amount: '₹25.00' }]}
          grandTotal="₹1,025.00"
          paymentStatus="PENDING"
        />,
      );

      expect(screen.getByText('Bill INV-892')).toBeInTheDocument();
      expect(screen.getByText('Table 04')).toBeInTheDocument();
      expect(screen.getByText(/Butter Chicken/)).toBeInTheDocument();
      expect(screen.getByText('₹1,000.00')).toBeInTheDocument();
      expect(screen.getByText('₹1,025.00')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('renders the title as an h4 by default and honours titleAs', () => {
      const { rerender } = render(<BillSummary invoiceNumber="7" subtotal="₹1" grandTotal="₹1" />);
      expect(screen.getByRole('heading', { level: 4, name: 'Bill 7' })).toBeInTheDocument();

      rerender(<BillSummary invoiceNumber="7" subtotal="₹1" grandTotal="₹1" titleAs="h3" />);
      expect(screen.getByRole('heading', { level: 3, name: 'Bill 7' })).toBeInTheDocument();

      rerender(<BillSummary invoiceNumber="7" subtotal="₹1" grandTotal="₹1" titleAs="p" />);
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(screen.getByText('Bill 7')).toBeInTheDocument();
    });
  });

  describe('Tabs', () => {
    it('renders tabs list with count badge', () => {
      render(
        <TabsList>
          <TabTrigger active count={12}>
            ACTIVE
          </TabTrigger>
          <TabTrigger count={4}>READY</TabTrigger>
        </TabsList>,
      );

      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('READY')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('only puts the active tab in the Tab order', () => {
      render(
        <TabsList>
          <TabTrigger active>A</TabTrigger>
          <TabTrigger>B</TabTrigger>
        </TabsList>,
      );
      expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('tabindex', '-1');
    });

    it('moves focus and activates with Arrow keys (wrapping), Home and End', async () => {
      const user = userEvent.setup();
      function Harness(): JSX.Element {
        const [active, setActive] = React.useState('a');
        return (
          <TabsList>
            {['a', 'b', 'c'].map((id) => (
              <TabTrigger key={id} active={active === id} onClick={() => setActive(id)}>
                {id}
              </TabTrigger>
            ))}
          </TabsList>
        );
      }
      render(<Harness />);
      const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

      tab('a').focus();
      await user.keyboard('{ArrowRight}');
      expect(tab('b')).toHaveFocus();
      expect(tab('b')).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{End}');
      expect(tab('c')).toHaveFocus();

      await user.keyboard('{ArrowRight}');
      expect(tab('a')).toHaveFocus();

      await user.keyboard('{ArrowLeft}');
      expect(tab('c')).toHaveFocus();

      await user.keyboard('{Home}');
      expect(tab('a')).toHaveFocus();
    });
  });

  describe('Skeleton and EmptyState', () => {
    it('renders Skeleton without crashing', () => {
      const { container } = render(<Skeleton className="h-6 w-24" />);
      expect(container.firstChild).toHaveClass('animate-pulse');
    });

    it('renders EmptyState with title and action', () => {
      render(
        <EmptyState
          title="No Orders Found"
          description="Try adjusting your filters"
          action={<button>Refresh</button>}
        />,
      );

      expect(screen.getByText('No Orders Found')).toBeInTheDocument();
      expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });
  });

  describe('DesignSystemShowcase', () => {
    it('renders complete visual showcase without throwing errors', () => {
      render(<DesignSystemShowcase />);
      expect(screen.getByText('RewardBite Design System Showcase')).toBeInTheDocument();
      expect(screen.getByText('DEMO DATA — VISUAL SHOWCASE ONLY')).toBeInTheDocument();
    });
  });
});
