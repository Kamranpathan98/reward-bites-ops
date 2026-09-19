import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './landing';

function renderLanding(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('LandingPage', () => {
  it('links to onboarding and sign-in', () => {
    renderLanding();

    const getStarted = screen.getAllByRole('link', { name: /Get started/i });
    expect(getStarted.length).toBeGreaterThanOrEqual(1);
    for (const link of getStarted) expect(link).toHaveAttribute('href', '/signup');

    const signIn = screen.getAllByRole('link', { name: /Sign in/i });
    expect(signIn.length).toBeGreaterThanOrEqual(1);
    for (const link of signIn) expect(link).toHaveAttribute('href', '/app/login');
  });

  it('has exactly one h1, and section headings never skip a level', () => {
    renderLanding();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Run your restaurant. Reward every guest.');

    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    let previous = 0;
    for (const level of levels) {
      expect(level - previous).toBeLessThanOrEqual(1);
      previous = level;
    }
  });

  it('uses a semantic brand link instead of a heading', () => {
    renderLanding();
    const brand = screen.getByRole('link', { name: 'RewardBite' });
    expect(brand).toHaveAttribute('href', '/');
    expect(screen.queryByRole('heading', { name: 'RewardBite' })).not.toBeInTheDocument();
  });

  it('provides a skip link to the main landmark', () => {
    renderLanding();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('marks unshipped features as coming soon and states what is available now', () => {
    renderLanding();

    const availability = screen.getByRole('heading', { name: 'Available now' }).parentElement;
    expect(availability).not.toBeNull();
    expect(within(availability as HTMLElement).getByText('Menu management')).toBeInTheDocument();

    for (const id of ['qr-title', 'kitchen-title', 'billing-title']) {
      const heading = document.getElementById(id);
      expect(heading).not.toBeNull();
      const row = (heading as HTMLElement).parentElement as HTMLElement;
      expect(within(row).getByText('Coming soon')).toBeInTheDocument();
    }
  });

  it('does not make claims outside V1 scope or expose internal language', () => {
    const { container } = renderLanding();
    // Open every gallery tab so all illustrated content is checked, not just the default one.
    const text: string[] = [];
    for (const name of ['Dashboard', 'Orders', 'Tables', 'Kitchen', 'Menu']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      text.push(container.textContent ?? '');
    }
    const all = text.join('\n');

    const banned = [
      /allerg/i,
      /nut-?free/i,
      /peanut/i,
      /reserv(ed|ation)/i,
      /floor plan/i,
      /\bCGST\b/,
      /\bSGST\b/,
      /\bGST\b/,
      /service charge/i,
      /card payment/i,
      /\bCard\b/,
      /loyalty points/i,
      /earn rewards/i,
      /multi-?tenant/i,
      /tenant/i,
      /idempotency/i,
      /Gate \d/i,
      /architectural/i,
      /domain entity/i,
      /audit trace/i,
      /warm operational/i,
      /RewardBite V1 Platform/i,
      /real-?time/i,
      /synchroni[sz]ed/i,
      /instantly/i,
      /captain/i,
      /guest count/i,
      /shift/i,
      /avg\.? ticket/i,
    ];
    for (const pattern of banned) {
      expect(all, `landing copy should not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('keeps the demo scenario consistent: Order #1042 is only ever Table 04 and PREPARING', () => {
    renderLanding();
    const hero = screen.getByRole('group', { name: /Illustration: Table 04/i });
    expect(within(hero).getAllByText(/1042/).length).toBeGreaterThan(0);
    expect(within(hero).getByText('Preparing')).toBeInTheDocument();
    expect(within(hero).queryByText('Bill Requested')).not.toBeInTheDocument();
    expect(within(hero).queryByText('Pending')).not.toBeInTheDocument();
  });

  it('renders the QR phone mock as a labelled image, not a fake control', () => {
    renderLanding();
    const phone = screen.getByRole('img', { name: /guest's phone at Table 04/i });
    expect(phone).toBeInTheDocument();
    expect(within(phone).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Place Order/i)).not.toBeInTheDocument();
  });

  it('renders no interactive kitchen or billing controls in the illustrations', () => {
    renderLanding();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bump|settle/i })).not.toBeInTheDocument();
  });

  describe('mobile navigation', () => {
    it('opens and closes the menu with correct aria state', () => {
      renderLanding();
      const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();

      fireEvent.click(toggle);
      expect(screen.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const mobileNav = screen.getByRole('navigation', { name: 'Mobile' });
      expect(within(mobileNav).getByRole('link', { name: 'Billing' })).toHaveAttribute(
        'href',
        '#billing',
      );

      fireEvent.click(within(mobileNav).getByRole('link', { name: 'Billing' }));
      expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
    });
  });

  describe('product gallery', () => {
    it('exposes Dashboard, Orders, Tables, Kitchen and Menu tabs (no Floor Plan)', () => {
      renderLanding();
      const tabs = within(screen.getByRole('tablist', { name: 'Product screens' })).getAllByRole(
        'tab',
      );
      expect(tabs.map((t) => t.textContent)).toEqual([
        'Dashboard',
        'Orders',
        'Tables',
        'Kitchen',
        'Menu',
      ]);
    });

    it('uses a roving tabindex and supports Arrow, Home and End keys', async () => {
      const user = userEvent.setup();
      renderLanding();

      const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });
      expect(tab('Orders')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Orders')).toHaveAttribute('tabindex', '0');
      expect(tab('Menu')).toHaveAttribute('tabindex', '-1');

      tab('Orders').focus();
      await user.keyboard('{ArrowRight}');
      expect(tab('Tables')).toHaveFocus();
      expect(tab('Tables')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'gallery-tab-tables');

      await user.keyboard('{End}');
      expect(tab('Menu')).toHaveFocus();
      expect(tab('Menu')).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{ArrowRight}');
      expect(tab('Dashboard')).toHaveFocus();

      await user.keyboard('{ArrowLeft}');
      expect(tab('Menu')).toHaveFocus();

      await user.keyboard('{Home}');
      expect(tab('Dashboard')).toHaveFocus();
    });

    it('shows only V1 dashboard metrics, with the operating-result caveat', () => {
      renderLanding();
      fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
      const panel = screen.getByRole('tabpanel');
      for (const title of [
        'Orders',
        'Revenue',
        'Collected',
        'Expenses',
        'Operating result',
        'Cash vs UPI',
        'Average order',
      ]) {
        expect(within(panel).getByText(title)).toBeInTheDocument();
      }
      expect(within(panel).getByText(/excludes stock, tax, salaries/i)).toBeInTheDocument();
      expect(within(panel).getByText('Coming soon')).toBeInTheDocument();
    });
  });

  describe('FAQ', () => {
    it('toggles answers with aria-expanded', () => {
      renderLanding();
      const question = screen.getByRole('button', { name: 'What can I use today?' });
      expect(question).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(question);
      expect(question).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('region', { name: 'What can I use today?' })).toBeInTheDocument();
      fireEvent.click(question);
      expect(question).toHaveAttribute('aria-expanded', 'false');
    });

    it('says plainly that there is no loyalty program', () => {
      renderLanding();
      fireEvent.click(screen.getByRole('button', { name: /loyalty or rewards program/i }));
      expect(screen.getByText(/There is no loyalty or rewards feature today/i)).toBeInTheDocument();
    });
  });
});
