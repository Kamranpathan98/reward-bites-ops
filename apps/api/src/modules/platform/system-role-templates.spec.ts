import { PERMISSION_KEYS } from '@rewardbite/contracts';
import { SYSTEM_ROLE_TEMPLATES } from './system-role-templates';

describe('SYSTEM_ROLE_TEMPLATES (architecture section 3)', () => {
  function template(name: string) {
    const found = SYSTEM_ROLE_TEMPLATES.find((t) => t.name === name);
    if (!found) throw new Error(`No template named ${name}`);
    return found;
  }

  it('has exactly the four system roles the architecture names', () => {
    expect(SYSTEM_ROLE_TEMPLATES.map((t) => t.name).sort()).toEqual(
      ['Cashier', 'Kitchen Staff', 'Manager', 'Owner'].sort(),
    );
  });

  it('Owner has every permission in the catalog', () => {
    expect(new Set(template('Owner').permissions)).toEqual(new Set(PERMISSION_KEYS));
  });

  it('Manager has everything except users.manage, settings.payments.manage, tenant.delete', () => {
    const manager = new Set(template('Manager').permissions);
    expect(manager.has('users.manage')).toBe(false);
    expect(manager.has('settings.payments.manage')).toBe(false);
    expect(manager.has('tenant.delete')).toBe(false);
    // Everything else should be present.
    const excluded = new Set(['users.manage', 'settings.payments.manage', 'tenant.delete']);
    for (const key of PERMISSION_KEYS) {
      if (!excluded.has(key)) expect(manager.has(key)).toBe(true);
    }
  });

  it('Cashier has orders.*, bills.*, payments.*, sessions.*, plus the three named extras', () => {
    const cashier = new Set(template('Cashier').permissions);
    for (const key of PERMISSION_KEYS) {
      if (
        key.startsWith('orders.') ||
        key.startsWith('bills.') ||
        key.startsWith('payments.') ||
        key.startsWith('sessions.')
      ) {
        expect(cashier.has(key)).toBe(true);
      }
    }
    expect(cashier.has('tables.read')).toBe(true);
    expect(cashier.has('menu.availability.update')).toBe(true);
    expect(cashier.has('kitchen.read')).toBe(true);
    expect(cashier.has('users.manage')).toBe(false);
    expect(cashier.has('menu.manage')).toBe(false);
  });

  it('Kitchen Staff has exactly kitchen.read, orders.transition.kitchen, menu.availability.update', () => {
    expect(new Set(template('Kitchen Staff').permissions)).toEqual(
      new Set(['kitchen.read', 'orders.transition.kitchen', 'menu.availability.update']),
    );
  });

  it('every permission referenced by every template exists in the shared catalog', () => {
    const catalog = new Set(PERMISSION_KEYS);
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      for (const key of t.permissions) {
        expect(catalog.has(key)).toBe(true);
      }
    }
  });
});
