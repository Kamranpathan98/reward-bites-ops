import { PERMISSION_KEYS, type PermissionKey } from '@rewardbite/contracts';

function byPrefix(...prefixes: string[]): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) =>
    prefixes.some((p) => key === p || key.startsWith(`${p}.`)),
  );
}

export interface SystemRoleTemplate {
  readonly name: string;
  readonly permissions: readonly PermissionKey[];
}

/**
 * The four system roles from architecture section 3, expressed exactly as
 * that table states them (Cashier's "orders.*, bills.*, payments.*" etc.
 * resolved by prefix against the seeded catalog). Applied by
 * `PlatformService.provisionTenant()` at tenant creation — per blueprint
 * section 5 stage 13's note, "per-tenant role/role_permission rows
 * themselves are created by the platform module at tenant provisioning
 * time, not by a migration." Kept as code, not DB rows, because `role`
 * requires a real `tenant_id` (no tenant-id-less template row is possible
 * under the locked 32-table catalog).
 */
const MANAGER_EXCLUDED = new Set<PermissionKey>([
  'users.manage',
  'settings.payments.manage',
  'tenant.delete',
]);

export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = [
  { name: 'Owner', permissions: PERMISSION_KEYS },
  {
    name: 'Manager',
    permissions: PERMISSION_KEYS.filter((key) => !MANAGER_EXCLUDED.has(key)),
  },
  {
    name: 'Cashier',
    permissions: [
      ...byPrefix('orders', 'bills', 'payments', 'sessions'),
      'tables.read',
      'menu.availability.update',
      'kitchen.read',
    ],
  },
  {
    name: 'Kitchen Staff',
    permissions: ['kitchen.read', 'orders.transition.kitchen', 'menu.availability.update'],
  },
];
