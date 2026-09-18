/**
 * The full permission-key catalog, kept in lockstep with
 * db/migrations/V202609180904__data_seed_permissions.sql — that migration
 * is the source of truth for what's actually seeded; this is the typed,
 * shared reference every `@RequirePermission(...)` call and frontend
 * `<Can permission="...">` check uses instead of a bare string literal.
 */
export const PERMISSION_KEYS = [
  'tenant.read',
  'tenant.update',
  'tenant.delete',
  'settings.read',
  'settings.update',
  'settings.payments.manage',
  'users.read',
  'users.manage',
  'tables.read',
  'tables.manage',
  'sessions.read',
  'sessions.close',
  'menu.read',
  'menu.manage',
  'menu.availability.update',
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.update.in_progress',
  'orders.transition.front',
  'orders.transition.kitchen',
  'orders.cancel',
  'orders.reopen',
  'kitchen.read',
  'bills.read',
  'bills.create',
  'bills.discount',
  'bills.finalize',
  'bills.void',
  'payments.read',
  'payments.record',
  'expenses.read',
  'expenses.manage',
  'dashboard.read',
  'audit.read',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
