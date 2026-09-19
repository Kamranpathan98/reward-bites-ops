import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { KitchenTicket } from '@/components/ui/kitchen-ticket';
import { BillSummary } from '@/components/ui/bill-summary';
import { TableStatus } from '@/components/ui/table-status';
import { cn } from '@/lib/utils';
import { LandingNav } from './components/landing-nav';
import { HeroScene } from './components/hero-scene';
import { SyncWorkflow } from './components/sync-workflow';
import { ProductGallery } from './components/product-gallery';
import { LandingFaq } from './components/landing-faq';
import { SectionHeader } from './components/landing-primitives';
import {
  BILL_PAID_1041,
  GALLERY_TICKETS,
  MENU,
  ORDER_1042,
  TABLES,
  formatRupees,
  orderItemCount,
  orderTotal,
} from './landing-demo-data';

const sectionClass = 'px-4 py-16 sm:px-6 sm:py-20 lg:px-8';
const containerClass = 'mx-auto w-full max-w-6xl';

const AVAILABLE_NOW = [
  'Restaurant setup',
  'Staff sign-in',
  'Menu management',
  'Tables and printable QR codes',
  'Staff order entry',
];
const COMING_SOON = ['QR ordering', 'Kitchen display', 'Billing', 'Payments', 'Dashboard'];

const TEAM = [
  { role: 'Owner', detail: 'Sets up the restaurant, the menu, and who has access.' },
  { role: 'Manager', detail: 'Runs the floor day to day.' },
  { role: 'Cashier', detail: 'Handles orders and payments at the counter.' },
  { role: 'Kitchen', detail: 'Sees what to cook and marks it ready.' },
];

function PhoneIllustration(): JSX.Element {
  return (
    <div
      role="img"
      aria-label="Illustration of a guest's phone at Table 04, showing two Butter Chicken and four Garlic Naan with an order total of ₹1,240"
      className="mx-auto w-full max-w-[280px] rounded-xl border-8 border-slate-800 bg-surface shadow-card"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between border-b border-border-subtle pb-3">
          <span className="text-base font-bold text-foreground">Table 04</span>
          <span className="text-xs text-muted-foreground">Menu</span>
        </div>
        <ul className="flex flex-col gap-3 text-sm">
          {[MENU.butterChicken, MENU.paneerTikka, MENU.garlicNaan].map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-2">
              <span className="text-foreground">{item.name}</span>
              <span className="font-tabular text-muted-foreground">{formatRupees(item.price)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-border-subtle pt-3 text-sm">
          <span className="text-muted-foreground">
            Your order · {orderItemCount(ORDER_1042)} items
          </span>
          <span className="font-tabular font-bold text-foreground">
            {formatRupees(orderTotal(ORDER_1042))}
          </span>
        </div>
      </div>
    </div>
  );
}

export function LandingPage(): JSX.Element {
  const table01 = TABLES.find((t) => t.number === '01');
  const table02 = TABLES.find((t) => t.number === '02');

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:shadow-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to content
      </a>
      <LandingNav />

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="px-4 pb-12 pt-12 sm:px-6 sm:pt-20 lg:px-8" aria-labelledby="hero-title">
          <div className={cn(containerClass, 'flex flex-col items-center gap-10')}>
            <div className="flex max-w-3xl flex-col items-center gap-5 text-center">
              <h1
                id="hero-title"
                className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl"
              >
                Run your restaurant.{' '}
                <span className="block text-primary-strong">Reward every guest.</span>
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Restaurant operations software for independent restaurants. Tables, orders, the
                kitchen and the bill, in one workflow.
              </p>
              <div className="flex w-full flex-col items-center gap-3 pt-2 sm:w-auto sm:flex-row">
                <Link
                  to="/signup"
                  className={cn(buttonVariants({ size: 'touch' }), 'w-full px-8 sm:w-auto')}
                >
                  Get started
                </Link>
                <a
                  href="#workflow"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'touch' }),
                    'w-full px-8 sm:w-auto',
                  )}
                >
                  See how it works
                </a>
              </div>
            </div>
            <HeroScene />
          </div>
        </section>

        {/* Availability */}
        <section className="px-4 sm:px-6 lg:px-8" aria-labelledby="availability-title">
          <div
            className={cn(
              containerClass,
              'grid gap-6 rounded-xl border border-border bg-surface p-5 sm:p-6 md:grid-cols-2',
            )}
          >
            <div className="flex flex-col gap-3">
              <h2 id="availability-title" className="text-lg font-semibold text-foreground">
                Available now
              </h2>
              <ul className="flex flex-wrap gap-2">
                {AVAILABLE_NOW.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-700"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Coming soon</h2>
              <ul className="flex flex-wrap gap-2">
                {COMING_SOON.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-border-subtle bg-surface-muted px-3 py-1 text-sm text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section id="workflow" className={sectionClass} aria-labelledby="workflow-title">
          <div className={cn(containerClass, 'flex flex-col gap-10')}>
            <SectionHeader id="workflow-title" title="One workflow, front to back">
              A table becomes an order, the order reaches the kitchen, and the kitchen’s work turns
              into a single bill.
            </SectionHeader>
            <SyncWorkflow />
          </div>
        </section>

        {/* QR ordering */}
        <section
          id="qr-ordering"
          className={cn(sectionClass, 'border-y border-border bg-surface-subtle')}
          aria-labelledby="qr-title"
        >
          <div className={cn(containerClass, 'grid items-center gap-10 md:grid-cols-2')}>
            <SectionHeader id="qr-title" title="Every table has its own QR code" comingSoon>
              Guests will scan the code at their table, browse the menu and send an order to your
              team, without downloading an app. Table QR codes can already be printed from the staff
              portal.
            </SectionHeader>
            <PhoneIllustration />
          </div>
        </section>

        {/* Kitchen */}
        <section id="kitchen" className={sectionClass} aria-labelledby="kitchen-title">
          <div className={cn(containerClass, 'grid items-center gap-10 md:grid-cols-2')}>
            <SectionHeader
              id="kitchen-title"
              title="Tickets your kitchen can read at a glance"
              comingSoon
            >
              Each order will arrive as a ticket with the table, the dishes and how long it has been
              waiting. Staff mark it ready, and the order status updates for everyone.
            </SectionHeader>
            <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        {/* Tables */}
        <section
          id="tables"
          className={cn(sectionClass, 'border-y border-border bg-surface-subtle')}
          aria-labelledby="tables-title"
        >
          <div className={cn(containerClass, 'grid items-center gap-10 md:grid-cols-2')}>
            <div className="grid gap-4 sm:grid-cols-2 md:order-2">
              {table01 && (
                <TableStatus
                  tableNumber={table01.number}
                  capacity={table01.seats}
                  state="AVAILABLE"
                  className="hover:shadow-sm"
                />
              )}
              {table02 && (
                <TableStatus
                  tableNumber={table02.number}
                  capacity={table02.seats}
                  state="OCCUPIED"
                  elapsedTime={`${table02.sessionMinutes ?? 0} min seated`}
                  className="hover:shadow-sm"
                />
              )}
            </div>
            <SectionHeader
              id="tables-title"
              title="Know which tables are seated"
              className="md:order-1"
            >
              Set up your tables once, print their QR codes, and see at a glance which are free and
              which have guests.
            </SectionHeader>
          </div>
        </section>

        {/* Billing */}
        <section id="billing" className={sectionClass} aria-labelledby="billing-title">
          <div className={cn(containerClass, 'grid items-center gap-10 md:grid-cols-2')}>
            <SectionHeader id="billing-title" title="One clear bill per table" comingSoon>
              Itemised bills with an optional discount, paid in cash or UPI. Payment status is
              tracked separately from the order, so a served order is never mistaken for a paid one.
            </SectionHeader>
            <BillSummary
              titleAs="h3"
              {...(BILL_PAID_1041.invoiceNumber
                ? { invoiceNumber: BILL_PAID_1041.invoiceNumber }
                : {})}
              tableLabel={BILL_PAID_1041.tableLabel}
              items={BILL_PAID_1041.items}
              subtotal={BILL_PAID_1041.subtotal}
              discounts={BILL_PAID_1041.discount ? [BILL_PAID_1041.discount] : []}
              grandTotal={BILL_PAID_1041.grandTotal}
              paymentStatus="PAID"
              paymentMethod="UPI"
              className="w-full max-w-sm md:justify-self-center"
            />
          </div>
        </section>

        {/* Team */}
        <section
          id="team"
          className={cn(sectionClass, 'border-y border-border bg-surface-subtle')}
          aria-labelledby="team-title"
        >
          <div className={cn(containerClass, 'flex flex-col gap-8')}>
            <SectionHeader id="team-title" title="Everyone works from the same picture">
              Give each person the access their job needs.
            </SectionHeader>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {TEAM.map((member) => (
                <div key={member.role} className="border-t border-border pt-3">
                  <dt className="font-semibold text-foreground">{member.role}</dt>
                  <dd className="text-sm text-muted-foreground">{member.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Gallery */}
        <section id="gallery" className={sectionClass} aria-labelledby="gallery-title">
          <div className={cn(containerClass, 'flex flex-col gap-8')}>
            <SectionHeader id="gallery-title" title="A look at the staff screens">
              Illustrations with sample data, so you can see how each screen is meant to read.
            </SectionHeader>
            <ProductGallery />
          </div>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          className={cn(sectionClass, 'border-t border-border bg-surface-subtle')}
          aria-labelledby="faq-title"
        >
          <div className={cn(containerClass, 'flex flex-col gap-8')}>
            <SectionHeader id="faq-title" title="Questions" />
            <LandingFaq />
          </div>
        </section>

        {/* Final CTA */}
        <section className={sectionClass} aria-labelledby="cta-title">
          <div className={cn(containerClass, 'flex flex-col items-start gap-5')}>
            <h2
              id="cta-title"
              className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
            >
              Set up your restaurant today
            </h2>
            <p className="max-w-prose text-base text-muted-foreground">
              Create your account, add your menu and tables, and invite your team.
            </p>
            <Link to="/signup" className={cn(buttonVariants({ size: 'touch' }), 'px-8')}>
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface px-4 py-6 sm:px-6 lg:px-8">
        <div
          className={cn(
            containerClass,
            'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
          )}
        >
          <p className="text-sm text-muted-foreground">© RewardBite</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-2">
            {[
              { to: '/signup', label: 'Get started' },
              { to: '/app/login', label: 'Sign in' },
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="#faq"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              FAQ
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
